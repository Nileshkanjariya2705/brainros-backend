import { Processor, WorkerHost, InjectQueue, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  EXAM_WINDOW_END_QUEUE_NAME,
  EVALUATION_QUEUE_NAME,
  ExamWindowEndJobPayload,
  ResultStatusEnum,
} from '../interfaces/result-lifecycle.interface';
import { ResultReadinessService } from '../services/result-readiness.service';
import { ExamLifecycleService } from '../../exam-scheduling/services/exam-lifecycle.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

import { NotificationService } from '../../notification/services/notification.service';
import {
  NotificationChannel,
  NotificationType,
  NotificationPriority,
} from '@prisma/client';

@Processor(EXAM_WINDOW_END_QUEUE_NAME, {
  concurrency: 2,
})
@Injectable()
export class ExamWindowEndProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamWindowEndProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly readinessService: ResultReadinessService,
    private readonly lifecycleService: ExamLifecycleService,
    @InjectQueue(EVALUATION_QUEUE_NAME)
    private readonly evaluationQueue: Queue,
    private readonly jobProgressService: JobProgressService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Exam window end worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<ExamWindowEndJobPayload>): Promise<any> {
    const { examId, scheduleId } = job.data;
    const jobId = String(job.id || `window_end_${examId}`);
    this.logger.log(
      `[ExamWindowEndWorker] Processing window closure for exam '${examId}' (Schedule: ${scheduleId || 'ALL'})`,
    );

    const lockKey = `lock:exam-window-end:${examId}`;
    const isLocked = await this.redisService.get(lockKey);
    if (isLocked) {
      this.logger.warn(
        `[ExamWindowEndWorker] Window end processing already in progress for exam '${examId}'. Skipping duplicate job.`,
      );
      return { skipped: true, reason: 'CONCURRENT_LOCK' };
    }

    // Acquire lock for 60 seconds
    await this.redisService.set(lockKey, 'locked', 60);

    await this.jobProgressService.publishStarted(EXAM_WINDOW_END_QUEUE_NAME, jobId, {
      type: 'EXAM_WINDOW_END',
      stage: 'CLOSING_WINDOW',
      examId,
      message: 'Processing exam window closure...',
    });

    try {
      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        include: {
          status: true,
          examTarget: true,
          schedules: {
            where: { status: { in: ['SCHEDULED', 'ACTIVE'] } },
          },
        },
      });

      if (!exam) {
        throw new Error(`Exam '${examId}' not found for window end processing.`);
      }

      const isLive = await this.readinessService.isLiveExam(examId);
      if (!isLive) {
        this.logger.log(
          `[ExamWindowEndWorker] Exam '${examId}' is a Mock/Practice test. Skipping deferred window processing.`,
        );
        return { skipped: true, reason: 'NOT_LIVE_EXAM' };
      }

      const now = new Date();

      // ─── STEP 1: Auto-submit any lingering IN_PROGRESS attempts ───
      const autoSubmittedStatus = await this.lifecycleService.getOrCreateExamStatus(
        'AUTO_SUBMITTED',
      );
      const inProgressAttempts = await this.prisma.attempt.findMany({
        where: {
          examId,
          status: { name: 'IN_PROGRESS' },
        },
        select: { id: true, serverEndTime: true },
      });

      let autoSubmittedCount = 0;
      for (const att of inProgressAttempts) {
        const effectiveEndTime =
          att.serverEndTime && now > att.serverEndTime
            ? att.serverEndTime
            : now;

        await this.prisma.attempt.update({
          where: { id: att.id },
          data: {
            statusId: autoSubmittedStatus.id,
            submittedAt: effectiveEndTime,
          },
        });

        await this.prisma.result.upsert({
          where: { attemptId: att.id },
          update: {
            resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
          },
          create: {
            attemptId: att.id,
            resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
            totalQuestions: 0,
            correctAnswers: 0,
            wrongAnswers: 0,
            unattempted: 0,
            totalScore: 0,
            maxScore: 0,
            percentage: 0,
            accuracy: 0,
            metadata: {
              deferred: true,
              autoSubmittedAtWindowEnd: true,
              reason: 'Auto-submitted at scheduled examination window end',
              submittedAt: effectiveEndTime.toISOString(),
            },
          },
        });
        autoSubmittedCount++;
      }

      if (autoSubmittedCount > 0) {
        this.logger.log(
          `[ExamWindowEndWorker] Auto-submitted ${autoSubmittedCount} in-progress attempts for exam '${examId}'.`,
        );
      }

      // ─── STEP 2: Transition Schedule and Exam to ENDED / EVALUATING ───
      if (scheduleId) {
        await this.prisma.examSchedule.updateMany({
          where: { id: scheduleId, status: { in: ['SCHEDULED', 'ACTIVE'] } },
          data: { status: 'ENDED' },
        });
      } else {
        await this.prisma.examSchedule.updateMany({
          where: { examId, status: { in: ['SCHEDULED', 'ACTIVE'] } },
          data: { status: 'ENDED' },
        });
      }

      if (exam.status?.name === 'ACTIVE') {
        try {
          await this.lifecycleService.endExam(examId);
        } catch (err: any) {
          this.logger.warn(
            `[ExamWindowEndWorker] Lifecycle transition to ENDED notice: ${err.message}`,
          );
        }
      }

      // ─── STEP 2.5: Official Exam Completion Notification Gate ───
      // Authoritative Requirement:
      // When an official/live exam reaches official End Time, do NOT immediately calculate final exam results.
      // Instead, notify SUPER_ADMIN and GENERAL_MANAGER: "Exam Completed — Please Upload Answer Key".
      // Authoritative final calculation begins ONLY after Answer Key is uploaded and validated.

      const targetSchedule = scheduleId
        ? await this.prisma.examSchedule.findUnique({ where: { id: scheduleId } })
        : await this.prisma.examSchedule.findFirst({
            where: { examId },
            orderBy: { startTime: 'desc' },
          });

      const totalAttemptsCount = await this.prisma.attempt.count({
        where: { examId },
      });

      const adminUsers = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          isActive: true,
          userRoles: {
            some: {
              role: {
                name: { in: ['SUPER_ADMIN', 'GENERAL_MANAGER'] },
              },
            },
          },
        },
        select: { id: true, email: true },
      });

      const targetExamName = (exam as any).examTarget?.name || 'General';
      const endTimeStr = targetSchedule?.endTime
        ? targetSchedule.endTime.toISOString()
        : now.toISOString();
      const answerKeyStatusStr = targetSchedule?.hasAnswerKey
        ? 'UPLOADED'
        : 'PENDING';
      const scheduleRefId = targetSchedule?.id || scheduleId || '';
      const actionUrl = `/super-admin/exam-manager/answer-key/${scheduleRefId}`;

      this.logger.log(
        `[ExamWindowEndWorker] Official exam '${exam.title}' has ended. Notifying ${adminUsers.length} administrators (Super Admin / General Manager) to upload Answer Key.`,
      );

      for (const adminUser of adminUsers) {
        try {
          await this.notificationService.sendNotification({
            recipientUserId: adminUser.id,
            recipientAddress: adminUser.email || '',
            channel: NotificationChannel.IN_APP,
            type: NotificationType.EXAM_ENDED,
            priority: NotificationPriority.HIGH,
            variables: {
              title: 'Exam Completed — Please Upload Answer Key',
              subject: `Exam Completed — Please Upload Answer Key: ${exam.title}`,
              message: `Official exam "${exam.title}" (${targetExamName}) has reached its official end time. Total attempts: ${totalAttemptsCount}. Answer key status: ${answerKeyStatusStr}. Please upload the answer key to begin batch result evaluation.`,
              examTitle: exam.title,
              examId: exam.id,
              scheduleId: scheduleRefId,
              examTarget: targetExamName,
              examType: (exam as any).examType || 'LIVE',
              endTime: endTimeStr,
              totalAttempts: totalAttemptsCount,
              answerKeyStatus: answerKeyStatusStr,
              actionUrl,
              data: {
                actionUrl,
                scheduleId: scheduleRefId,
                examId: exam.id,
                entityType: 'ANSWER_KEY',
              },
            },
            idempotencyKey: `exam_ended_inapp_${exam.id}_${adminUser.id}`,
          });

          if (adminUser.email) {
            await this.notificationService.sendNotification({
              recipientUserId: adminUser.id,
              recipientAddress: adminUser.email,
              channel: NotificationChannel.EMAIL,
              type: NotificationType.EXAM_ENDED,
              priority: NotificationPriority.HIGH,
              variables: {
                subject: `Exam Completed — Please Upload Answer Key: ${exam.title}`,
                body: `Official exam "${exam.title}" (${targetExamName}) reached its scheduled end time at ${endTimeStr}.\n\nTotal Attempts: ${totalAttemptsCount}\nAnswer Key Status: ${answerKeyStatusStr}\n\nPlease upload the answer key to begin batch result evaluation.`,
                examTitle: exam.title,
                examId: exam.id,
                scheduleId: scheduleRefId,
                examTarget: targetExamName,
                examType: (exam as any).examType || 'LIVE',
                endTime: endTimeStr,
                totalAttempts: totalAttemptsCount,
                answerKeyStatus: answerKeyStatusStr,
                actionUrl,
                data: {
                  actionUrl,
                  scheduleId: scheduleRefId,
                  examId: exam.id,
                  entityType: 'ANSWER_KEY',
                },
              },
              idempotencyKey: `exam_ended_email_${exam.id}_${adminUser.id}`,
            });
          }
        } catch (notifErr: any) {
          this.logger.warn(
            `[ExamWindowEndWorker] Failed notifying admin user '${adminUser.id}': ${notifErr.message}`,
          );
        }
      }

      await this.jobProgressService.publishCompleted(EXAM_WINDOW_END_QUEUE_NAME, jobId, {
        message: `Official exam window closed for '${exam.title}'. Notified Super Admin & General Manager to upload Answer Key.`,
        examId,
        resultSummary: {
          autoSubmittedCount,
          totalAttempts: totalAttemptsCount,
          answerKeyStatus: answerKeyStatusStr,
          deferred: true,
          reason: 'AWAITING_ANSWER_KEY_UPLOAD',
        },
      });

      return {
        success: true,
        examId,
        examTitle: exam.title,
        autoSubmittedCount,
        totalAttempts: totalAttemptsCount,
        answerKeyStatus: answerKeyStatusStr,
        notifiedAdminsCount: adminUsers.length,
        deferred: true,
        reason: 'AWAITING_ANSWER_KEY_UPLOAD',
      };
    } catch (err: any) {
      await this.jobProgressService.publishFailed(
        EXAM_WINDOW_END_QUEUE_NAME,
        jobId,
        err.message || 'Exam window closure processing failed.',
      );
      throw err;
    } finally {
      await this.redisService.del(lockKey);
    }
  }
}
