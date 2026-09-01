import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  RANKING_QUEUE_NAME,
  RankingJobPayload,
} from '../interfaces/result-lifecycle.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { RankGenerationService } from '../../rank-engine/services/rank-generation.service';
import { ResultReadinessService } from '../services/result-readiness.service';

@Processor(RANKING_QUEUE_NAME, {
  concurrency: 3,
})
export class RankingProcessor extends WorkerHost {
  private readonly logger = new Logger(RankingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rankGenerationService: RankGenerationService,
    private readonly readinessService: ResultReadinessService,
  ) {
    super();
  }

  async process(job: Job<RankingJobPayload>): Promise<any> {
    const { examId, attemptId } = job.data;
    this.logger.log(
      `[RankingWorker] Starting rank and percentile processing for exam '${examId}' (Attempt: ${attemptId || 'ALL'})`,
    );

    try {
      // 1. Run batch rank & percentile calculation
      try {
        await this.rankGenerationService.generateRanks({
          examId,
          snapshotVersion: job.data.snapshotVersion || 1,
          forceRegenerate: true,
        });
      } catch (rankErr: any) {
        this.logger.warn(
          `[RankingWorker] Rank generation notice for exam '${examId}': ${rankErr.message}`,
        );
      }

      // 2. Trigger Result Readiness & Publication Check
      if (attemptId) {
        await this.readinessService.onAttemptWorkflowCompleted(attemptId);
      } else {
        await this.readinessService.checkExamReadiness(examId);
      }

      this.logger.log(
        `[RankingWorker] Ranking & Readiness process completed for exam '${examId}'.`,
      );

      return { success: true, examId, attemptId };
    } catch (err: any) {
      this.logger.error(
        `[RankingWorker] Failed ranking for exam '${examId}': ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
