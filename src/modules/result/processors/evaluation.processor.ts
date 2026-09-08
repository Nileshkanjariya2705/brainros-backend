import { Processor, WorkerHost, InjectQueue, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ResultService } from '../result.service';
import {
  EVALUATION_QUEUE_NAME,
  ANALYTICS_QUEUE_NAME,
  EvaluationJobPayload,
  ResultStatusEnum,
} from '../interfaces/result-lifecycle.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

@Processor(EVALUATION_QUEUE_NAME, {
  concurrency: 5,
})
export class EvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(EvaluationProcessor.name);

  constructor(
    private readonly resultService: ResultService,
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYTICS_QUEUE_NAME)
    private readonly analyticsQueue: Queue,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Evaluation worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<EvaluationJobPayload>): Promise<any> {
    const { attemptId } = job.data;
    const jobId = String(job.id || `eval_${attemptId}`);
    this.logger.log(
      `[EvaluationWorker] Starting evaluation job for attempt '${attemptId}' (Job ID: ${jobId})`,
    );

    // Retrieve attempt owner to attach userId
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: { student: { select: { userId: true } } },
    });
    const userId = (attempt as any)?.student?.userId;

    await this.jobProgressService.publishStarted(EVALUATION_QUEUE_NAME, jobId, {
      type: 'EXAM_EVALUATION',
      stage: 'EVALUATION',
      attemptId,
      userId,
      message: 'Evaluating exam responses...',
    });

    try {
      // 1. Calculate question-level scoring and result atomicity
      const result = await this.resultService.calculateResult(attemptId);

      await this.jobProgressService.publishProgress(
        EVALUATION_QUEUE_NAME,
        jobId,
        50,
        100,
        {
          stage: 'EVALUATION',
          stageIndex: 1,
          totalStages: 3,
          message: 'Evaluation completed. Marking result...',
          attemptId,
          userId,
        },
      );

      // 2. Mark Result Status as EVALUATED
      if (result) {
        await this.prisma.result.update({
          where: { id: result.id },
          data: { resultStatus: ResultStatusEnum.EVALUATED },
        });
      }

      // 3. Enqueue Next Stage: Analytics Worker
      const analyticsJobId = `analytics_${attemptId}`;
      await this.analyticsQueue.add(
        'RUN_ANALYTICS',
        {
          attemptId,
          triggeredAt: new Date().toISOString(),
        },
        {
          jobId: analyticsJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1500 },
          removeOnComplete: true,
        },
      );

      await this.jobProgressService.publishCompleted(EVALUATION_QUEUE_NAME, jobId, {
        message: 'Evaluation stage completed successfully.',
        resultSummary: { attemptId, score: result?.totalScore },
        attemptId,
        userId,
      });

      this.logger.log(
        `[EvaluationWorker] Evaluation completed for attempt '${attemptId}'. Enqueued analytics job.`,
      );

      return { success: true, attemptId, score: result?.totalScore };
    } catch (err: any) {
      this.logger.error(
        `[EvaluationWorker] Failed evaluation for attempt '${attemptId}': ${err.message}`,
        err.stack,
      );

      await this.jobProgressService.publishFailed(
        EVALUATION_QUEUE_NAME,
        jobId,
        err.message || 'Evaluation failed.',
      );

      // Mark result as FAILED if error persists
      try {
        const res = await this.prisma.result.findUnique({
          where: { attemptId },
        });
        if (res) {
          await this.prisma.result.update({
            where: { id: res.id },
            data: { resultStatus: ResultStatusEnum.FAILED },
          });
        }
      } catch {}

      throw err;
    }
  }
}
