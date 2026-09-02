import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
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
  ) {
    super();
  }

  async process(job: Job<ExamWindowEndJobPayload>): Promise<any> {
    const { examId, scheduleId } = job.data;
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

    try {
      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        include: {
          status: true,
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

      // Transition to EVALUATING status if possible
      try {
        const evaluatingStatus = await this.lifecycleService.getOrCreateExamStatus('EVALUATING');
        await this.prisma.exam.update({
          where: { id: examId },
          data: { statusId: evaluatingStatus.id },
        });
        await this.lifecycleService.recordHistory({
          examId,
          action: 'START_EVALUATION',
          fromStatus: 'ENDED',
          toStatus: 'EVALUATING',
          performedById: exam.createdById,
          comment: 'Automated batch evaluation triggered after scheduled window ended.',
        });
      } catch (lifecycleErr: any) {
        this.logger.warn(
          `[ExamWindowEndWorker] Status transition to EVALUATING notice: ${lifecycleErr.message}`,
        );
      }

      // ─── STEP 3: Find all finalized attempts needing evaluation ───
      const eligibleAttempts = await this.prisma.attempt.findMany({
        where: {
          examId,
          status: { name: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
          OR: [
            { result: null },
            {
              result: {
                resultStatus: {
                  in: [
                    ResultStatusEnum.PENDING_WINDOW_CLOSE,
                    ResultStatusEnum.PROCESSING,
                    ResultStatusEnum.FAILED,
                  ],
                },
              },
            },
          ],
        },
        select: { id: true, studentId: true },
      });

      this.logger.log(
        `[ExamWindowEndWorker] Enqueueing batch evaluation for ${eligibleAttempts.length} candidate attempts for exam '${examId}'.`,
      );

      // ─── STEP 4: Batch Enqueue to EVALUATION_QUEUE_NAME ───
      let enqueuedCount = 0;
      for (const att of eligibleAttempts) {
        // Update Result state to PROCESSING so UI reflects active scoring
        await this.prisma.result.upsert({
          where: { attemptId: att.id },
          update: {
            resultStatus: ResultStatusEnum.PROCESSING,
          },
          create: {
            attemptId: att.id,
            resultStatus: ResultStatusEnum.PROCESSING,
            totalQuestions: 0,
            correctAnswers: 0,
            wrongAnswers: 0,
            unattempted: 0,
            totalScore: 0,
            maxScore: 0,
            percentage: 0,
            accuracy: 0,
            metadata: {
              batchEvaluated: true,
              enqueuedAt: now.toISOString(),
            },
          },
        });

        const evalJobId = `eval_${att.id}`;
        await this.evaluationQueue.add(
          'EVALUATE_ATTEMPT',
          {
            attemptId: att.id,
            triggeredAt: now.toISOString(),
            evaluationMode: 'DEFERRED',
          },
          {
            jobId: evalJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
          },
        );
        enqueuedCount++;
      }

      this.logger.log(
        `[ExamWindowEndWorker] Successfully initiated batch evaluation for ${enqueuedCount} attempts. Exam: '${exam.title}'.`,
      );

      return {
        success: true,
        examId,
        examTitle: exam.title,
        autoSubmittedCount,
        enqueuedEvaluations: enqueuedCount,
      };
    } finally {
      await this.redisService.del(lockKey);
    }
  }
}
