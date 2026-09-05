import { Processor, WorkerHost, InjectQueue, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ResultService } from '../result.service';
import { ResultReadinessService } from '../services/result-readiness.service';
import { ResultAccessService } from '../services/result-access.service';
import {
  RECONCILIATION_QUEUE_NAME,
  EVALUATION_QUEUE_NAME,
  EXAM_WINDOW_END_QUEUE_NAME,
  ReconciliationJobPayload,
  ResultStatusEnum,
} from '../interfaces/result-lifecycle.interface';

@Processor(RECONCILIATION_QUEUE_NAME, {
  concurrency: 1,
})
@Injectable()
export class ResultReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ResultReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly resultService: ResultService,
    private readonly readinessService: ResultReadinessService,
    private readonly resultAccessService: ResultAccessService,
    @InjectQueue(EVALUATION_QUEUE_NAME)
    private readonly evaluationQueue: Queue,
    @InjectQueue(EXAM_WINDOW_END_QUEUE_NAME)
    private readonly windowEndQueue: Queue,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Reconciliation worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<ReconciliationJobPayload>): Promise<any> {
    const lockKey = 'lock:result-reconciliation-run';
    const isLocked = await this.redisService.get(lockKey);
    if (isLocked) {
      this.logger.debug('[Reconciliation] Skipping run: another worker is active.');
      return { skipped: true, reason: 'LOCKED' };
    }

    // Acquire lock for 60s
    await this.redisService.set(lockKey, 'locked', 60);

    try {
      this.logger.log('[Reconciliation] Starting periodic background result reconciliation check.');
      const stats = {
        repairedMockPublished: 0,
        repairedLiveReady: 0,
        requeuedMissingResults: 0,
        processedTotal: 0,
      };

      const now = Date.now();
      const STUCK_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

      // 1. Find attempts with existing Result that are stuck in intermediate statuses
      const stuckCalculatedResults = await this.prisma.result.findMany({
        where: {
          totalScore: { gte: 0 },
          resultStatus: {
            in: [
              ResultStatusEnum.PROCESSING,
              ResultStatusEnum.EVALUATED,
              ResultStatusEnum.ANALYTICS_PROCESSING,
              ResultStatusEnum.RANKING_PROCESSING,
            ],
          },
        },
        include: {
          attempt: {
            include: {
              exam: { select: { id: true, title: true } },
              timeAnalyses: { take: 1 },
              strategyAnalyses: { take: 1 },
            },
          },
        },
        take: 50,
      });

      for (const res of stuckCalculatedResults) {
        stats.processedTotal++;
        const isLive = await this.readinessService.isLiveExam(res.attempt.examId);

        if (!isLive) {
          // For Mock test, auto-publish if calculated
          await this.prisma.result.update({
            where: { id: res.id },
            data: {
              resultStatus: ResultStatusEnum.PUBLISHED,
              publishedAt: res.publishedAt || new Date(),
              publicationVersion: 1,
            },
          });
          await this.resultAccessService.invalidateResultCache(
            res.attemptId,
            res.attempt.studentId,
            res.attempt.examId,
          );
          stats.repairedMockPublished++;
          this.logger.log(`[Reconciliation] Auto-repaired Mock result '${res.attemptId}' -> PUBLISHED`);
        } else {
          // For Live exam, transition to READY_TO_PUBLISH if analytics complete
          const analyticsComplete =
            res.attempt.timeAnalyses?.length > 0 &&
            res.attempt.strategyAnalyses?.length > 0;

          if (analyticsComplete && res.resultStatus !== ResultStatusEnum.READY_TO_PUBLISH) {
            await this.prisma.result.update({
              where: { id: res.id },
              data: {
                resultStatus: ResultStatusEnum.READY_TO_PUBLISH,
              },
            });
            await this.resultAccessService.invalidateResultCache(
              res.attemptId,
              res.attempt.studentId,
              res.attempt.examId,
            );
            stats.repairedLiveReady++;
            this.logger.log(`[Reconciliation] Repaired Live result '${res.attemptId}' -> READY_TO_PUBLISH`);
          }
        }
      }

      // 2. Find submitted attempts missing a Result where submittedAt > STUCK_THRESHOLD_MS
      const stuckSubmittedAttempts = await this.prisma.attempt.findMany({
        where: {
          status: { name: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
          result: null,
          submittedAt: {
            lte: new Date(now - STUCK_THRESHOLD_MS),
          },
        },
        select: { id: true, examId: true, studentId: true },
        take: 20,
      });

      for (const att of stuckSubmittedAttempts) {
        stats.processedTotal++;
        try {
          const isLive = await this.readinessService.isLiveExam(att.examId);
          if (isLive) {
            // If Live exam schedule is still active, defer calculation until window ends
            const activeSchedule = await this.prisma.examSchedule.findFirst({
              where: { examId: att.examId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
              orderBy: { endTime: 'desc' },
            });
            if (activeSchedule && new Date(activeSchedule.endTime).getTime() > now) {
              // Still in live window, skip
              continue;
            }
          }

          // Safely calculate directly or requeue
          this.logger.warn(`[Reconciliation] Detected un-evaluated submitted attempt '${att.id}'. Triggering calculation.`);
          await this.resultService.calculateResult(att.id);
          stats.requeuedMissingResults++;
        } catch (calcErr: any) {
          this.logger.error(`[Reconciliation] Failed recovery calculation for '${att.id}': ${calcErr.message}`);
        }
      }

      // 3. Find Live Exams whose scheduled window has closed but evaluations remain PENDING_WINDOW_CLOSE
      const endedLiveExamsNeedingEvaluation = await this.prisma.exam.findMany({
        where: {
          schedules: {
            some: {
              status: { in: ['ENDED', 'ACTIVE'] },
              endTime: { lte: new Date(now) },
            },
          },
          attempts: {
            some: {
              status: { name: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
              result: { resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE },
            },
          },
        },
        select: { id: true, title: true },
        take: 10,
      });

      for (const endedExam of endedLiveExamsNeedingEvaluation) {
        this.logger.log(
          `[Reconciliation] Triggering window-end batch processing for exam '${endedExam.title}' (${endedExam.id}).`,
        );
        await this.windowEndQueue.add(
          'EXAM_WINDOW_END',
          {
            examId: endedExam.id,
            triggeredAt: new Date().toISOString(),
          },
          {
            jobId: `window_end_reconciliation_${endedExam.id}`,
            removeOnComplete: true,
          },
        );
      }

      // 4. Find IN_PROGRESS attempts whose serverEndTime has passed and auto-submit them
      const autoSubmittedStatus = await this.prisma.attemptStatus.findUnique({
        where: { name: 'AUTO_SUBMITTED' },
      });
      if (autoSubmittedStatus) {
        const expiredAttempts = await this.prisma.attempt.findMany({
          where: {
            status: { name: 'IN_PROGRESS' },
            serverEndTime: { lte: new Date(now) },
          },
          select: { id: true, examId: true, serverEndTime: true },
          take: 20,
        });

        for (const exp of expiredAttempts) {
          try {
            this.logger.log(
              `[Reconciliation] Auto-submitting expired in-progress attempt '${exp.id}' (ServerEndTime passed).`,
            );
            await this.prisma.attempt.update({
              where: { id: exp.id },
              data: {
                statusId: autoSubmittedStatus.id,
                submittedAt: exp.serverEndTime || new Date(now),
              },
            });

            const isLive = await this.readinessService.isLiveExam(exp.examId);
            if (isLive) {
              await this.prisma.result.upsert({
                where: { attemptId: exp.id },
                update: { resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE },
                create: {
                  attemptId: exp.id,
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
                    autoSubmittedByReconciliation: true,
                    reason: 'Auto-submitted after serverEndTime expired',
                  },
                },
              });
            } else {
              // Mock test: enqueue evaluation
              const evalJobId = `eval_${exp.id}`;
              await this.evaluationQueue.add(
                'EVALUATE_ATTEMPT',
                { attemptId: exp.id, triggeredAt: new Date().toISOString(), evaluationMode: 'IMMEDIATE' },
                {
                  jobId: evalJobId,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1000 },
                  removeOnComplete: true,
                },
              );
            }
          } catch (autoErr: any) {
            this.logger.error(
              `[Reconciliation] Failed auto-submitting expired attempt '${exp.id}': ${autoErr.message}`,
            );
          }
        }
      }

      this.logger.log(
        `[Reconciliation] Finished run. Repaired: ${stats.repairedMockPublished} mocks, ${stats.repairedLiveReady} live. Recovered: ${stats.requeuedMissingResults} missing results. Triggered batch processing for: ${endedLiveExamsNeedingEvaluation.length} ended live exams.`,
      );

      return { success: true, stats };
    } finally {
      await this.redisService.del(lockKey);
    }
  }
}
