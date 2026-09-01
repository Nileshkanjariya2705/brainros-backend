import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  ANALYTICS_QUEUE_NAME,
  RANKING_QUEUE_NAME,
  AnalyticsJobPayload,
  ResultStatusEnum,
} from '../interfaces/result-lifecycle.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { ResultService } from '../result.service';

@Processor(ANALYTICS_QUEUE_NAME, {
  concurrency: 5,
})
export class AnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resultService: ResultService,
    @InjectQueue(RANKING_QUEUE_NAME)
    private readonly rankingQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<AnalyticsJobPayload>): Promise<any> {
    const { attemptId } = job.data;
    this.logger.log(
      `[AnalyticsWorker] Starting analytics processing for attempt '${attemptId}'`,
    );

    try {
      const attempt = await this.prisma.attempt.findUnique({
        where: { id: attemptId },
        include: { exam: true, result: true },
      });

      if (!attempt) {
        throw new Error(`Attempt '${attemptId}' not found for analytics`);
      }

      // 1. Mark status as ANALYTICS_PROCESSING
      if (attempt.result) {
        await this.prisma.result.update({
          where: { id: attempt.result.id },
          data: { resultStatus: ResultStatusEnum.ANALYTICS_PROCESSING },
        });
      }

      // 2. Execute Time Analysis & Attempt Strategy calculations
      await this.resultService.getTimeAnalysis(attemptId);
      await this.resultService.getAttemptStrategy(attemptId);

      // 3. Mark status as RANKING_PROCESSING
      if (attempt.result) {
        await this.prisma.result.update({
          where: { id: attempt.result.id },
          data: { resultStatus: ResultStatusEnum.RANKING_PROCESSING },
        });
      }

      // 4. Enqueue Ranking Worker
      const rankingJobId = `ranking_${attemptId}`;
      await this.rankingQueue.add(
        'RUN_RANKING',
        {
          examId: attempt.examId,
          attemptId,
          triggeredAt: new Date().toISOString(),
        },
        {
          jobId: rankingJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1500 },
          removeOnComplete: true,
        },
      );

      this.logger.log(
        `[AnalyticsWorker] Analytics completed for attempt '${attemptId}'. Enqueued ranking job.`,
      );

      return { success: true, attemptId };
    } catch (err: any) {
      this.logger.error(
        `[AnalyticsWorker] Failed analytics for attempt '${attemptId}': ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
