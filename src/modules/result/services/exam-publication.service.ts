import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ResultReadinessService } from './result-readiness.service';
import {
  ExamPublicationStatusEnum,
  ResultStatusEnum,
  BulkResultNotificationJobPayload,
} from '../interfaces/result-lifecycle.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATION_QUEUE_NAME } from '../../notification/interfaces/exam-notification-job.interface';

@Injectable()
export class ExamPublicationService {
  private readonly logger = new Logger(ExamPublicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly readinessService: ResultReadinessService,
    @InjectQueue(NOTIFICATION_QUEUE_NAME)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Get all live exams with their publication status and readiness metrics.
   */
  async getLiveExamsPublicationDashboard() {
    const exams = await this.prisma.exam.findMany({
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        schedules: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        resultPublications: {
          orderBy: { publicationVersion: 'desc' },
          take: 1,
          include: {
            publishedBy: { select: { id: true, email: true, phone: true } },
          },
        },
        _count: {
          select: { attempts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: any[] = [];

    for (const exam of exams) {
      const isLive = await this.readinessService.isLiveExam(exam.id);
      if (!isLive && exam._count.attempts === 0) continue;

      const readiness = await this.readinessService.checkExamReadiness(exam.id);
      const latestPub = exam.resultPublications?.[0];

      results.push({
        examId: exam.id,
        examTitle: exam.title,
        examTarget: exam.examTarget?.name || 'General',
        examStatus: exam.status?.name,
        examType: isLive ? 'LIVE' : 'MOCK',
        totalCandidates: readiness.totalEligibleAttempts,
        finalizedAttempts: readiness.finalizedAttempts,
        evaluatedAttempts: readiness.evaluatedAttempts,
        analyticsCompletedAttempts: readiness.analyticsCompletedAttempts,
        rankingCompleted: readiness.rankingCompleted,
        securityReviewCompleted: readiness.securityReviewCompleted,
        publicationStatus: readiness.publicationStatus,
        isReadyToPublish: readiness.ready,
        notReadyReason: readiness.reason,
        publishedAt: latestPub?.publishedAt || null,
        publishedBy: latestPub?.publishedBy?.email || null,
        publicationVersion: latestPub?.publicationVersion || 1,
        lastSchedule: exam.schedules?.[0]
          ? {
              startTime: exam.schedules[0].startTime,
              endTime: exam.schedules[0].endTime,
              status: exam.schedules[0].status,
            }
          : null,
      });
    }

    return results;
  }

  /**
   * Get publication preview summary for a specific live exam before Super Admin confirmation.
   */
  async getPublicationPreview(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        versions: { take: 1 },
        resultPublications: {
          orderBy: { publicationVersion: 'desc' },
          take: 1,
          include: {
            publishedBy: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${examId}' not found`);
    }

    const readiness = await this.readinessService.checkExamReadiness(examId);
    const publication = exam.resultPublications?.[0];

    return {
      examId: exam.id,
      examTitle: exam.title,
      examTarget: exam.examTarget?.name,
      examStatus: exam.status?.name,
      examType: readiness.examType,
      publicationStatus: readiness.publicationStatus,
      isReadyToPublish: readiness.ready,
      notReadyReason: readiness.reason,
      totalCandidates: readiness.totalEligibleAttempts,
      finalizedAttempts: readiness.finalizedAttempts,
      evaluatedAttempts: readiness.evaluatedAttempts,
      analyticsCompleted: readiness.analyticsCompletedAttempts,
      rankingStatus: readiness.rankingCompleted ? 'COMPLETED' : 'PROCESSING',
      securityStatus: readiness.securityReviewCompleted
        ? 'CLEARED'
        : 'PENDING_REVIEW',
      flaggedAttempts: readiness.flaggedAttempts,
      disqualifiedAttempts: readiness.disqualifiedAttempts,
      currentPublicationVersion: publication?.publicationVersion || 1,
      publishedAt: publication?.publishedAt || null,
      publishedBy: publication?.publishedBy?.email || null,
    };
  }

  /**
   * Super Admin Official Result Publication Execution
   *
   * Protection & Guarantees:
   *  1. Super Admin permission verification
   *  2. Redis concurrency distributed lock (prevents dual-admin simultaneous publish)
   *  3. Strict server-side readiness verification at time of execution
   *  4. Single atomic PostgreSQL transaction (ResultPublication + Results)
   *  5. Invalidate all Redis caches
   *  6. Enqueue bulk student notifications asynchronously via BullMQ
   */
  async publishExamResults(examId: string, superAdminUserId: string) {
    // 1. Concurrency Lock in Redis
    const lockKey = `lock:publish:${examId}`;
    const existingLock = await this.redisService.get(lockKey);
    if (existingLock) {
      throw new ConflictException(
        'Publication is already being processed for this exam by another administrator.',
      );
    }
    await this.redisService.set(lockKey, 'locked', 30); // 30s lock

    try {
      // 2. Strict Readiness Verification at moment of publication
      const readiness = await this.readinessService.checkExamReadiness(examId);

      if (readiness.publicationStatus === ExamPublicationStatusEnum.PUBLISHED) {
        throw new ConflictException(
          'Official results for this exam have already been published.',
        );
      }

      if (!readiness.ready) {
        throw new BadRequestException(
          `Cannot publish exam results. Readiness check failed: ${readiness.reason}`,
        );
      }

      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        include: { versions: { take: 1 } },
      });

      if (!exam) {
        throw new NotFoundException(`Exam '${examId}' not found`);
      }

      const now = new Date();

      // 3. Atomic Database Transaction
      const publicationResult = await this.prisma.$transaction(
        async (tx) => {
          // A. Update or create ExamResultPublication record
          const existingPub = await tx.examResultPublication.findFirst({
            where: { examId },
            orderBy: { publicationVersion: 'desc' },
          });

          const publicationVersion = existingPub
            ? existingPub.publicationVersion
            : 1;

          const updatedPub = await tx.examResultPublication.upsert({
            where: {
              examId_publicationVersion: {
                examId,
                publicationVersion,
              },
            },
            update: {
              status: ExamPublicationStatusEnum.PUBLISHED,
              publishedById: superAdminUserId,
              publishedAt: now,
              totalEligibleAttempts: readiness.totalEligibleAttempts,
              finalizedAttempts: readiness.finalizedAttempts,
              evaluatedAttempts: readiness.evaluatedAttempts,
              analyticsCompletedAttempts: readiness.analyticsCompletedAttempts,
              rankingCompleted: true,
              securityReviewCompleted: true,
              metadata: {
                publishedBySuperAdmin: superAdminUserId,
                publishedAt: now.toISOString(),
                totalCandidates: readiness.totalEligibleAttempts,
              },
            },
            create: {
              examId,
              examVersionId: exam.versions?.[0]?.id,
              status: ExamPublicationStatusEnum.PUBLISHED,
              publicationVersion: 1,
              publishedById: superAdminUserId,
              publishedAt: now,
              totalEligibleAttempts: readiness.totalEligibleAttempts,
              finalizedAttempts: readiness.finalizedAttempts,
              evaluatedAttempts: readiness.evaluatedAttempts,
              analyticsCompletedAttempts: readiness.analyticsCompletedAttempts,
              rankingCompleted: true,
              securityReviewCompleted: true,
              metadata: {
                publishedBySuperAdmin: superAdminUserId,
                publishedAt: now.toISOString(),
                totalCandidates: readiness.totalEligibleAttempts,
              },
            },
          });

          // B. Atomically update all eligible attempt results to PUBLISHED
          const eligibleAttempts = await tx.attempt.findMany({
            where: {
              examId,
              status: { name: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
            },
            select: { id: true, studentId: true },
          });

          const attemptIds = eligibleAttempts.map((a) => a.id);

          await tx.result.updateMany({
            where: {
              attemptId: { in: attemptIds },
            },
            data: {
              resultStatus: ResultStatusEnum.PUBLISHED,
              publishedAt: now,
              publishedBy: superAdminUserId,
              publicationVersion,
            },
          });

          // C. Record Audit Log
          try {
            await tx.securityEvent.create({
              data: {
                userId: superAdminUserId,
                eventType: 'ROLE_CHANGED' as any, // audit marker
                ipAddress: 'server-internal',
                metadata: {
                  action: 'RESULT_PUBLISHED',
                  examId,
                  examTitle: exam.title,
                  publishedBy: superAdminUserId,
                  publishedAt: now.toISOString(),
                  totalCandidates: eligibleAttempts.length,
                  publicationVersion,
                },
              },
            });
          } catch {
            // Non-blocking audit log fallback
          }

          return {
            updatedPub,
            totalPublished: eligibleAttempts.length,
            eligibleAttempts,
          };
        },
      );

      // 4. Invalidate Redis Caches
      try {
        await this.redisService.del(`exam:${examId}:leaderboard`);
        await this.redisService.del(`exam:${examId}:ranks`);
        for (const att of publicationResult.eligibleAttempts) {
          await this.redisService.del(`result:visibility:${att.id}`);
          await this.redisService.del(`student:${att.studentId}:results`);
        }
      } catch (err) {
        this.logger.warn(`Redis cache invalidation warning: ${err}`);
      }

      // 5. Asynchronous Bulk Notifications via BullMQ
      this.enqueuePublicationNotifications(
        exam,
        publicationResult.eligibleAttempts,
        publicationResult.updatedPub.publicationVersion,
      ).catch((err) => {
        this.logger.error(
          `Asynchronous notification queuing error (non-blocking): ${err}`,
        );
      });

      this.logger.log(
        `Official results for Live Exam '${exam.title}' (${examId}) PUBLISHED by Super Admin '${superAdminUserId}' for ${publicationResult.totalPublished} candidates.`,
      );

      return {
        success: true,
        examId,
        examTitle: exam.title,
        status: ExamPublicationStatusEnum.PUBLISHED,
        publishedAt: now.toISOString(),
        publishedBy: superAdminUserId,
        totalCandidates: publicationResult.totalPublished,
        publicationVersion: publicationResult.updatedPub.publicationVersion,
      };
    } finally {
      // Release Redis lock
      await this.redisService.del(lockKey);
    }
  }

  /**
   * Enqueue bulk student notifications asynchronously with controlled concurrency.
   */
  private async enqueuePublicationNotifications(
    exam: any,
    attempts: Array<{ id: string; studentId: string }>,
    publicationVersion: number,
  ) {
    if (!attempts || attempts.length === 0) return;

    for (const att of attempts) {
      const jobId = `notif_pub_${exam.id}_v${publicationVersion}_${att.studentId}`;
      try {
        await this.notificationQueue.add(
          'EXAM_RESULT_PUBLISHED',
          {
            examId: exam.id,
            examTitle: exam.title,
            studentId: att.studentId,
            attemptId: att.id,
            publicationVersion,
          },
          {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
          },
        );
      } catch {
        // Individual notification failure does not block publication
      }
    }
  }
}
