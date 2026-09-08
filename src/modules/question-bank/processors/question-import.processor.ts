import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QuestionImportService } from '../services/question-import.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

export interface QuestionImportJobData {
  importId: string;
  userId: string;
  action: 'VALIDATE' | 'EXECUTE';
}

@Processor('question-import')
@Injectable()
export class QuestionImportProcessor extends WorkerHost {
  private readonly logger = new Logger(QuestionImportProcessor.name);

  constructor(
    private readonly questionImportService: QuestionImportService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Question import worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<QuestionImportJobData>): Promise<any> {
    const { importId, userId, action } = job.data;
    const jobId = String(job.id || `q_import_${importId}`);
    this.logger.log(
      `Processing background job '${job.name}' (action: ${action}) for import ID: ${importId}`,
    );

    await this.jobProgressService.publishStarted('question-import', jobId, {
      type: 'QUESTION_IMPORT',
      stage: action === 'VALIDATE' ? 'VALIDATING_FILE' : 'IMPORTING_QUESTIONS',
      userId,
      resourceId: importId,
      message: action === 'VALIDATE' ? 'Validating question bank file...' : 'Importing question bank records...',
    });

    try {
      let result: any;
      if (action === 'VALIDATE') {
        result = await this.questionImportService.parseAndValidateImport(importId);
      } else if (action === 'EXECUTE') {
        result = await this.questionImportService.executeImport(importId, userId);
      } else {
        throw new Error(`Unsupported job action '${action}'`);
      }

      await this.jobProgressService.publishCompleted('question-import', jobId, {
        message: `Question import ${action.toLowerCase()} completed successfully.`,
        userId,
        resultSummary: typeof result === 'object' ? result : { success: true },
      });

      return result;
    } catch (err: any) {
      this.logger.error(
        `Background job '${job.name}' failed for import ${importId}: ${err.message}`,
        err.stack,
      );

      await this.jobProgressService.publishFailed(
        'question-import',
        jobId,
        err.message || 'Question import failed.',
      );

      throw err;
    }
  }
}
