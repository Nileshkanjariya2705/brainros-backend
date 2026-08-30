import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ExamNotificationJobData,
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_JOB_NAMES,
} from '../interfaces/exam-notification-job.interface';

@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE_NAME)
    private readonly notificationQueue: Queue<ExamNotificationJobData>,
  ) {}

  /**
   * Dispatch an asynchronous exam notification job to BullMQ
   */
  async dispatchExamNotificationJob(jobData: ExamNotificationJobData) {
    try {
      const jobId = `${jobData.type}_${jobData.examId}_${jobData.scheduleId || Date.now()}`;
      
      const job = await this.notificationQueue.add(
        NOTIFICATION_JOB_NAMES.EXAM_NOTIFICATION,
        jobData,
        {
          jobId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 3000,
          },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );

      this.logger.log(
        `Dispatched exam notification job [${job.id}] for Exam '${jobData.examId}' (Type: ${jobData.type})`,
      );
      return job;
    } catch (error: any) {
      this.logger.error(
        `Failed to dispatch exam notification job for Exam '${jobData.examId}': ${error.message}`,
        error.stack,
      );
      // Fallback: don't throw to avoid breaking the core exam scheduling transaction
      return null;
    }
  }
}
