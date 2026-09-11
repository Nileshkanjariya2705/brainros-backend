import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  EXAM_CACHE_PREPARATION_QUEUE_NAME,
  PrepareExamCacheJobData,
} from '../interfaces/exam-cache.interface';
import { ExamCacheService } from '../services/exam-cache.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

@Processor(EXAM_CACHE_PREPARATION_QUEUE_NAME)
@Injectable()
export class ExamCacheProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamCacheProcessor.name);

  constructor(
    private readonly examCacheService: ExamCacheService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(
      `[ExamCacheProcessor] Worker error event: ${err.message}`,
    );
  }

  async process(job: Job<PrepareExamCacheJobData>): Promise<any> {
    const { examId, examVersionId, scheduleId, officialExamEndTime, userId } =
      job.data;
    const jobId = String(job.id || `cache_prep_${examId}_${examVersionId}`);

    this.logger.log(
      `[ExamCacheProcessor] Starting cache preparation job ${jobId} for exam ${examId}, version ${examVersionId}`,
    );

    // 1. Stage: PREPARING (0%)
    await this.jobProgressService.publishStarted(
      EXAM_CACHE_PREPARATION_QUEUE_NAME,
      jobId,
      {
        type: 'EXAM_CACHE_PREPARATION',
        stage: 'PREPARING',
        examId,
        userId,
        message: 'Initializing exam cache preparation...',
      },
    );

    try {
      // 2. Stage: LOADING_QUESTIONS (20%)
      await this.jobProgressService.publishProgress(
        EXAM_CACHE_PREPARATION_QUEUE_NAME,
        jobId,
        {
          current: 1,
          total: 5,
          percentage: 20,
          stage: 'LOADING_QUESTIONS',
          examId,
          userId,
          message: 'Loading immutable ExamVersion and questions from PostgreSQL...',
        },
      );

      // 3. Stage: BUILDING_SNAPSHOT (40%)
      await this.jobProgressService.publishProgress(
        EXAM_CACHE_PREPARATION_QUEUE_NAME,
        jobId,
        {
          current: 2,
          total: 5,
          percentage: 40,
          stage: 'BUILDING_SNAPSHOT',
          examId,
          userId,
          message: 'Building complete question-paper snapshot with multilingual options...',
        },
      );

      // 4. Stage: WRITING_REDIS (60%)
      await this.jobProgressService.publishProgress(
        EXAM_CACHE_PREPARATION_QUEUE_NAME,
        jobId,
        {
          current: 3,
          total: 5,
          percentage: 60,
          stage: 'WRITING_REDIS',
          examId,
          userId,
          message: 'Writing question-paper snapshot to Redis runtime cache with official end-time TTL...',
        },
      );

      const prepResult = await this.examCacheService.prepareExamCache({
        examId,
        examVersionId,
        scheduleId,
        officialEndTime: officialExamEndTime
          ? new Date(officialExamEndTime)
          : undefined,
        userId,
      });

      // 5. Stage: VERIFYING_CACHE (80%)
      await this.jobProgressService.publishProgress(
        EXAM_CACHE_PREPARATION_QUEUE_NAME,
        jobId,
        {
          current: 4,
          total: 5,
          percentage: 80,
          stage: 'VERIFYING_CACHE',
          examId,
          userId,
          message: 'Verifying Redis cache integrity, question count, and translation coverage...',
        },
      );

      // 6. Stage: CACHE_READY (100%)
      await this.jobProgressService.publishCompleted(
        EXAM_CACHE_PREPARATION_QUEUE_NAME,
        jobId,
        {
          current: 5,
          total: 5,
          percentage: 100,
          stage: 'CACHE_READY',
          examId,
          userId,
          message: `Cache verified and marked READY. ${prepResult.snapshot.totalQuestions} questions cached.`,
        },
      );

      return {
        success: true,
        examId,
        examVersionId,
        questionCount: prepResult.snapshot.totalQuestions,
        ttlSeconds: prepResult.snapshot.ttlSeconds,
      };
    } catch (err: any) {
      this.logger.error(
        `[ExamCacheProcessor] Cache preparation job ${jobId} failed: ${err.message}`,
      );

      await this.jobProgressService.publishFailed(
        EXAM_CACHE_PREPARATION_QUEUE_NAME,
        jobId,
        err.message || 'Exam cache preparation failed',
        'EXAM_CACHE_PREPARATION_ERROR',
      );

      throw err;
    }
  }
}
