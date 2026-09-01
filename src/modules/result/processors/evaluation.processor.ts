import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
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
  ) {
    super();
  }

  async process(job: Job<EvaluationJobPayload>): Promise<any> {
    const { attemptId } = job.data;
    this.logger.log(
      `[EvaluationWorker] Starting evaluation job for attempt '${attemptId}' (Job ID: ${job.id})`,
    );

    try {
      // 1. Calculate question-level scoring and result atomicity
      const result = await this.resultService.calculateResult(attemptId);

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

      this.logger.log(
        `[EvaluationWorker] Evaluation completed for attempt '${attemptId}'. Enqueued analytics job.`,
      );

      return { success: true, attemptId, score: result?.totalScore };
    } catch (err: any) {
      this.logger.error(
        `[EvaluationWorker] Failed evaluation for attempt '${attemptId}': ${err.message}`,
        err.stack,
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
