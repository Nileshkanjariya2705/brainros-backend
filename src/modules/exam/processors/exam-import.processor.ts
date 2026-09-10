import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ExamPaperImportService } from '../services/exam-paper-import.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

export interface ExamImportJobData {
  importId: string;
  examId: string;
  userId: string;
  filePath: string;
  originalFileName: string;
}

@Processor('exam-import-queue')
@Injectable()
export class ExamImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamImportProcessor.name);

  constructor(
    private readonly examPaperImportService: ExamPaperImportService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Exam import worker runtime error: ${err.message}`);
  }

  async process(job: Job<ExamImportJobData>): Promise<any> {
    const { importId, examId, userId, filePath, originalFileName } = job.data;
    const jobId = String(job.id || `exam_import_${importId}`);

    this.logger.log(
      `Starting background question paper import [Job: ${jobId}, Import: ${importId}, Exam: ${examId}]`,
    );

    await this.jobProgressService.publishStarted('exam-import-queue', jobId, {
      type: 'QUESTION_PAPER_IMPORT',
      stage: 'VALIDATING',
      userId,
      examId,
      resourceId: importId,
      message: 'Reading and validating question paper...',
    });

    try {
      const result = await this.examPaperImportService.executeBackgroundExamImport(
        job.data,
        async (current: number, total: number, stage: string, message: string) => {
          await this.jobProgressService.publishProgress(
            'exam-import-queue',
            jobId,
            current,
            total,
            { stage, message, examId, userId },
          );
        },
      );

      await this.jobProgressService.publishCompleted('exam-import-queue', jobId, {
        message: 'Question paper imported and verified successfully.',
        userId,
        examId,
        resourceId: importId,
        resultSummary: {
          success: true,
          questionsCreated: result?.questionsCreated || 0,
          sectionsCreated: result?.sectionsCreated || 0,
        },
      });

      return result;
    } catch (err: any) {
      this.logger.error(
        `Background question paper import failed for exam ${examId}: ${err.message}`,
        err.stack,
      );

      await this.jobProgressService.publishFailed(
        'exam-import-queue',
        jobId,
        err.message || 'Question paper processing failed.',
        'QUESTION_PAPER_IMPORT_FAILED',
      );

      throw err;
    }
  }
}
