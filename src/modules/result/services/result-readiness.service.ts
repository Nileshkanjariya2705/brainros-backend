import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  ResultReadinessResponse,
  ResultStatusEnum,
  ExamPublicationStatusEnum,
} from '../interfaces/result-lifecycle.interface';

@Injectable()
export class ResultReadinessService {
  private readonly logger = new Logger(ResultReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Determine whether an exam is a synchronized LIVE exam or an on-demand MOCK test.
   */
  async isLiveExam(examId: string): Promise<boolean> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        schedules: {
          where: { status: { in: ['SCHEDULED', 'ACTIVE', 'ENDED'] } },
          take: 1,
        },
      },
    });

    if (!exam) return false;

    // If an exam has official synchronized schedules or title/description flags it as Live
    const hasSchedules = (exam.schedules && exam.schedules.length > 0);
    const titleIndicatesLive =
      exam.title?.toUpperCase().includes('LIVE') &&
      !exam.title?.toUpperCase().includes('PRACTICE');

    return Boolean(hasSchedules || titleIndicatesLive);
  }

  /**
   * Authoritative Live Exam Result Readiness Evaluation
   * Verifies:
   *  1. All eligible attempts are in finalized state (SUBMITTED / AUTO_SUBMITTED)
   *  2. Question evaluation complete for all eligible candidates
   *  3. Subject / Chapter / Time / Strategy analytics complete
   *  4. Batch Rank & Percentile snapshot complete
   *  5. Security clearance validation according to policy
   */
  async checkExamReadiness(
    examId: string,
    requireAllSecurityReviews = true,
  ): Promise<ResultReadinessResponse> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        status: true,
        versions: { take: 1, orderBy: { versionNumber: 'desc' } },
        schedules: {
          where: { status: { in: ['ACTIVE', 'ENDED', 'SCHEDULED'] } },
          take: 1,
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${examId}' not found`);
    }

    const isLive = await this.isLiveExam(examId);

    // 1. Query all non-cancelled, non-empty attempts for this exam
    const allAttempts = await this.prisma.attempt.findMany({
      where: {
        examId,
        status: {
          name: { notIn: ['CANCELLED', 'NOT_STARTED'] },
        },
      },
      include: {
        status: true,
        result: true,
        timeAnalyses: { take: 1 },
        strategyAnalyses: { take: 1 },
        candidateRanks: { take: 1 },
        securityReviews: { where: { status: 'PENDING' }, take: 1 },
      },
    });

    const totalEligibleAttempts = allAttempts.length;

    // Filter finalized attempts (SUBMITTED or AUTO_SUBMITTED)
    const finalizedAttempts = allAttempts.filter((a) =>
      ['SUBMITTED', 'AUTO_SUBMITTED'].includes(a.status?.name),
    );

    const evaluatedAttempts = finalizedAttempts.filter(
      (a) => a.result !== null && (a.result as any).totalScore !== undefined,
    );

    const analyticsCompletedAttempts = finalizedAttempts.filter(
      (a) =>
        a.timeAnalyses &&
        a.timeAnalyses.length > 0 &&
        a.strategyAnalyses &&
        a.strategyAnalyses.length > 0,
    );

    // Check rank snapshot completion
    const latestRankSnapshot = await this.prisma.rankSnapshot.findFirst({
      where: { examId },
      orderBy: { snapshotVersion: 'desc' },
    });
    const rankingCompleted = latestRankSnapshot?.status === 'COMPLETED';

    // Security reviews
    const flaggedAttempts = allAttempts.filter((a) => a.isFlagged).length;
    const disqualifiedAttempts = allAttempts.filter(
      (a) => a.disqualifiedAt !== null,
    ).length;
    const pendingSecurityReviews = allAttempts.filter(
      (a) => a.securityReviews && a.securityReviews.length > 0,
    ).length;

    const securityReviewCompleted = requireAllSecurityReviews
      ? pendingSecurityReviews === 0
      : true;

    const pendingEvaluationCount =
      finalizedAttempts.length - evaluatedAttempts.length;

    // Check existing ExamResultPublication
    let publicationRecord = await this.prisma.examResultPublication.findFirst({
      where: { examId },
      orderBy: { publicationVersion: 'desc' },
    });

    let publicationStatus =
      publicationRecord?.status || ExamPublicationStatusEnum.NOT_READY;

    // Reasons why it might not be ready
    let reason: string | null = null;
    let isReady = false;

    if (totalEligibleAttempts === 0) {
      reason = 'No student attempts recorded for this exam.';
    } else if (finalizedAttempts.length < totalEligibleAttempts) {
      const activeCount = totalEligibleAttempts - finalizedAttempts.length;
      reason = `${activeCount} candidate attempt(s) are still in progress and not yet finalized.`;
    } else if (evaluatedAttempts.length < finalizedAttempts.length) {
      reason = `${pendingEvaluationCount} attempt(s) are still undergoing scoring/evaluation.`;
    } else if (analyticsCompletedAttempts.length < finalizedAttempts.length) {
      reason = `${finalizedAttempts.length - analyticsCompletedAttempts.length} attempt(s) are undergoing time & strategy analytics.`;
    } else if (!rankingCompleted) {
      reason = 'Official rank and percentile calculation is in progress.';
    } else if (!securityReviewCompleted) {
      reason = `${pendingSecurityReviews} flagged attempt(s) require security review before publication.`;
    } else {
      isReady = true;
      reason = null;
    }

    // Auto update / upsert ExamResultPublication state
    if (publicationStatus !== ExamPublicationStatusEnum.PUBLISHED) {
      const newStatus = isReady
        ? ExamPublicationStatusEnum.READY_TO_PUBLISH
        : ExamPublicationStatusEnum.PROCESSING;

      if (!publicationRecord) {
        publicationRecord = await this.prisma.examResultPublication.create({
          data: {
            examId,
            examVersionId: exam.versions?.[0]?.id,
            status: newStatus as any,
            totalEligibleAttempts,
            finalizedAttempts: finalizedAttempts.length,
            evaluatedAttempts: evaluatedAttempts.length,
            analyticsCompletedAttempts: analyticsCompletedAttempts.length,
            rankingCompleted,
            securityReviewCompleted,
            metadata: {
              flaggedAttempts,
              disqualifiedAttempts,
              pendingSecurityReviews,
              lastCheckedAt: new Date().toISOString(),
            },
          },
        });
      } else {
        publicationRecord = await this.prisma.examResultPublication.update({
          where: { id: publicationRecord.id },
          data: {
            status: newStatus as any,
            totalEligibleAttempts,
            finalizedAttempts: finalizedAttempts.length,
            evaluatedAttempts: evaluatedAttempts.length,
            analyticsCompletedAttempts: analyticsCompletedAttempts.length,
            rankingCompleted,
            securityReviewCompleted,
            metadata: {
              flaggedAttempts,
              disqualifiedAttempts,
              pendingSecurityReviews,
              lastCheckedAt: new Date().toISOString(),
            },
          },
        });
      }
      publicationStatus = publicationRecord.status;
    }

    return {
      ready: isReady,
      examId,
      examTitle: exam.title,
      examType: isLive ? 'LIVE' : 'MOCK',
      publicationStatus,
      totalEligibleAttempts,
      finalizedAttempts: finalizedAttempts.length,
      evaluatedAttempts: evaluatedAttempts.length,
      analyticsCompletedAttempts: analyticsCompletedAttempts.length,
      rankingCompleted,
      securityReviewCompleted,
      flaggedAttempts,
      disqualifiedAttempts,
      pendingEvaluationAttempts: pendingEvaluationCount,
      reason,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Handles attempt lifecycle completion after all asynchronous workers finish.
   * If MOCK: Automatically marks Result = PUBLISHED.
   * If LIVE: Verifies whole exam readiness and transitions to READY_TO_PUBLISH if complete.
   */
  async onAttemptWorkflowCompleted(attemptId: string): Promise<void> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { exam: true, result: true },
    });

    if (!attempt || !attempt.result) return;

    const isLive = await this.isLiveExam(attempt.examId);

    if (!isLive) {
      // ─── MOCK TEST: Automatic Publication ─────────────────────────────
      await this.prisma.result.update({
        where: { id: attempt.result.id },
        data: {
          resultStatus: ResultStatusEnum.PUBLISHED,
          publishedAt: new Date(),
          publicationVersion: 1,
        },
      });

      // Warm cache
      await this.redisService.set(
        `result:visibility:${attemptId}`,
        JSON.stringify({
          status: ResultStatusEnum.PUBLISHED,
          publishedAt: new Date().toISOString(),
        }),
        3600,
      );

      this.logger.log(
        `Mock Test attempt '${attemptId}' automatically PUBLISHED.`,
      );
    } else {
      // ─── LIVE EXAM: Mark Attempt as READY_TO_PUBLISH ───────────────────
      const currentResStatus = (attempt.result as any).resultStatus;
      if (currentResStatus !== ResultStatusEnum.PUBLISHED) {
        await this.prisma.result.update({
          where: { id: attempt.result.id },
          data: {
            resultStatus: ResultStatusEnum.READY_TO_PUBLISH,
          },
        });
      }

      // Check if the overall Live Exam is now ready to publish
      await this.checkExamReadiness(attempt.examId);
      this.logger.log(
        `Live Exam attempt '${attemptId}' completed processing. Result marked READY_TO_PUBLISH.`,
      );
    }
  }
}
