import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QuestionImportService } from '../services/question-import.service';

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
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Question import worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<QuestionImportJobData>): Promise<any> {
    const { importId, userId, action } = job.data;
    this.logger.log(
      `Processing background job '${job.name}' (action: ${action}) for import ID: ${importId}`,
    );

    try {
      if (action === 'VALIDATE') {
        return await this.questionImportService.parseAndValidateImport(importId);
      } else if (action === 'EXECUTE') {
        return await this.questionImportService.executeImport(importId, userId);
      } else {
        throw new Error(`Unsupported job action '${action}'`);
      }
    } catch (err: any) {
      this.logger.error(
        `Background job '${job.name}' failed for import ${importId}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
