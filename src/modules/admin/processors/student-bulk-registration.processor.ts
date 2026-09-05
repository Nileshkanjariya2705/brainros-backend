import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { StudentBulkRegistrationService } from '../services/student-bulk-registration.service';

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
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Student bulk registration worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<StudentBulkRegistrationJobData>): Promise<any> {
    const { uploadId, actor } = job.data;
    this.logger.log(
      `[StudentBulkRegistrationProcessor] Processing bulk registration job for Upload: ${uploadId} (Job ID: ${job.id})`,
    );

    try {
      const result = await this.bulkRegistrationService.executeBulkRegistration(
        uploadId,
        actor,
      );

      this.logger.log(
        `[StudentBulkRegistrationProcessor] Job ${job.id} completed: ${result.activated} activated, ${result.failed} failed.`,
      );

      return result;
    } catch (err: any) {
      this.logger.error(
        `[StudentBulkRegistrationProcessor] Job ${job.id} failed for Upload ${uploadId}: ${err.message}`,
      );
      throw err;
    }
  }
}
