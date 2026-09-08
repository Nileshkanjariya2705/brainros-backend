import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { StudentBulkRegistrationService } from '../services/student-bulk-registration.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

export interface StudentBulkRegistrationJobData {
  uploadId: string;
  actor: {
    userId: string;
    email?: string;
  };
}

@Processor('student-bulk-registration')
@Injectable()
export class StudentBulkRegistrationProcessor extends WorkerHost {
  private readonly logger = new Logger(StudentBulkRegistrationProcessor.name);

  constructor(
    private readonly bulkRegistrationService: StudentBulkRegistrationService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(
      `Student bulk registration worker connection/runtime error: ${err.message}`,
    );
  }

  async process(job: Job<StudentBulkRegistrationJobData>): Promise<any> {
    const jobId = String(job.id || `bulk-reg-${Date.now()}`);
    const { uploadId, actor } = job.data;
    this.logger.log(
      `[StudentBulkRegistrationProcessor] Processing bulk registration job for Upload: ${uploadId} (Job ID: ${jobId})`,
    );

    await this.jobProgressService.publishStarted('student-bulk-registration', jobId, {
      type: 'STUDENT_BULK_REGISTRATION',
      stage: 'PROCESSING_ROWS',
      userId: actor?.userId,
      message: 'Processing bulk student registration...',
    });

    try {
      const result = await this.bulkRegistrationService.executeBulkRegistration(
        uploadId,
        actor,
      );

      const total = (result?.activated || 0) + (result?.failed || 0) || 100;
      await this.jobProgressService.publishProgress(
        'student-bulk-registration',
        jobId,
        total,
        total,
        {
          stage: 'COMPLETED',
          message: `Processed ${total} students: ${result.activated} activated, ${result.failed} failed.`,
          userId: actor?.userId,
        },
      );

      await this.jobProgressService.publishCompleted(
        'student-bulk-registration',
        jobId,
        {
          message: `Bulk registration completed: ${result.activated} registered, ${result.failed} failed.`,
          resultSummary: result,
          totalProcessed: total,
          userId: actor?.userId,
        },
      );

      return result;
    } catch (err: any) {
      this.logger.error(
        `[StudentBulkRegistrationProcessor] Job ${jobId} failed for Upload ${uploadId}: ${err.message}`,
      );
      await this.jobProgressService.publishFailed(
        'student-bulk-registration',
        jobId,
        err.message || 'Bulk student registration failed.',
      );
      throw err;
    }
  }
}
