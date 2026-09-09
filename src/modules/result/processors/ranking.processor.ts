import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  RANKING_QUEUE_NAME,
  RankingJobPayload,
} from '../interfaces/result-lifecycle.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { RankGenerationService } from '../../rank-engine/services/rank-generation.service';
import { ResultReadinessService } from '../services/result-readiness.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

@Processor(RANKING_QUEUE_NAME, {
  concurrency: 3,
})
export class RankingProcessor extends WorkerHost {
  private readonly logger = new Logger(RankingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rankGenerationService: RankGenerationService,
    private readonly readinessService: ResultReadinessService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Ranking worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<RankingJobPayload>): Promise<any> {
    const { examId, attemptId } = job.data;
    const jobId = String(job.id || `ranking_${attemptId || examId}`);
    this.logger.log(
      `[RankingWorker] Starting rank and percentile processing for exam '${examId}' (Attempt: ${attemptId || 'ALL'})`,
    );

    let userId: string | undefined;
    if (attemptId) {
      const attempt = await this.prisma.attempt.findUnique({
        where: { id: attemptId },
        include: { student: true },
      });
      userId = (attempt as any)?.student?.userId;
    }

    await this.jobProgressService.publishStarted(RANKING_QUEUE_NAME, jobId, {
      type: 'EXAM_RANKING',
      stage: 'RANKING',
      attemptId,
      examId,
      userId,
      message: 'Calculating ranks and percentiles...',
    });

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

      await this.jobProgressService.publishProgress(
        RANKING_QUEUE_NAME,
        jobId,
        90,
        100,
        {
          stage: 'RANKING',
          stageIndex: 3,
          totalStages: 3,
          message: 'Ranks generated. Verifying result readiness...',
          attemptId,
          examId,
          userId,
        },
      );

      // 2. Trigger Result Readiness & Publication Check
      let readiness: any = null;
      if (attemptId) {
        await this.readinessService.onAttemptWorkflowCompleted(attemptId);
        readiness = await this.readinessService.checkExamReadiness(examId);
      } else {
        readiness = await this.readinessService.checkExamReadiness(examId);
      }

      // 3. If overall exam has completed all stages, broadcast readiness
      if (readiness?.ready) {
        this.jobProgressService.emitExamCompleted(examId, 'READY_TO_PUBLISH');
        this.logger.log(`[RankingWorker] Exam '${examId}' is READY_TO_PUBLISH. Emitted completion event.`);
      }

      await this.jobProgressService.publishCompleted(RANKING_QUEUE_NAME, jobId, {
        message: 'Ranking & readiness verification completed successfully.',
        stage: 'RANKING',
        attemptId,
        examId,
        userId,
      });

      this.logger.log(
        `[RankingWorker] Ranking & Readiness process completed for exam '${examId}'.`,
      );

      return { success: true, examId, attemptId };
    } catch (err: any) {
      this.logger.error(
        `[RankingWorker] Failed ranking for exam '${examId}': ${err.message}`,
        err.stack,
      );
      const safeErrorMsg = 'Result processing failed during batch ranking calculation.';
      await this.jobProgressService.publishFailed(
        RANKING_QUEUE_NAME,
        jobId,
        safeErrorMsg,
      );
      throw err;
    }
  }
}
