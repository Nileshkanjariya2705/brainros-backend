import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ExamNotificationJobData,
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_JOB_NAMES,
  WhatsAppReminderJobData,
  WHATSAPP_REMINDER_QUEUE_NAME,
  WHATSAPP_JOB_NAMES,
} from '../interfaces/exam-notification-job.interface';

@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE_NAME)
    private readonly notificationQueue: Queue<ExamNotificationJobData>,
    @Optional()
    @InjectQueue(WHATSAPP_REMINDER_QUEUE_NAME)
    private readonly whatsAppQueue: Queue<WhatsAppReminderJobData> | null,
  ) {}

  /**
   * Dispatch an asynchronous exam notification job to BullMQ (in-app notifications).
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

  /**
   * Dispatch a WhatsApp reminder job to the dedicated whatsapp-reminder BullMQ queue.
   *
   * @param data Job payload including notificationId for idempotency
   * @param delayMs Delay before job executes (0 = immediate, >0 = scheduled reminder)
   * @returns BullMQ Job or null if queue is unavailable
   */
  async dispatchWhatsAppReminderJob(
    data: WhatsAppReminderJobData,
    delayMs = 0,
  ) {
    if (!this.whatsAppQueue) {
      this.logger.warn(
        `[WhatsApp Queue] Queue unavailable (Redis disabled?). Cannot dispatch job for notification '${data.notificationId}'.`,
      );
      return null;
    }

    try {
      // Job ID is the notificationId — ensures exactly-once enqueue for BullMQ
      // (BullMQ will ignore duplicate jobId additions if the job already exists)
      const jobId = `wa_${data.notificationId}`;

      const job = await this.whatsAppQueue.add(
        WHATSAPP_JOB_NAMES.SEND_REMINDER,
        data,
        {
          jobId,
          delay: delayMs > 0 ? delayMs : undefined,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000, // 5s, 10s, 20s, 40s, 80s
          },
          removeOnComplete: 200,
          removeOnFail: 1000,
        },
      );

      this.logger.log(
        `[WhatsApp Queue] Dispatched job [${job.id}] for notification '${data.notificationId}' ` +
          `(type: ${data.reminderType}, delay: ${delayMs}ms)`,
      );
      return job;
    } catch (error: any) {
      this.logger.error(
        `[WhatsApp Queue] Failed to dispatch job for notification '${data.notificationId}': ${error.message}`,
        error.stack,
      );
      // Non-throwing: WhatsApp failure must never break exam scheduling or publication
      return null;
    }
  }

  /**
   * Remove a pending WhatsApp reminder job by its notificationId.
   * Used when an exam is rescheduled or cancelled.
   *
   * @param notificationId The Notification DB record ID
   * @returns true if job was found and removed, false otherwise
   */
  async removeWhatsAppReminderJob(notificationId: string): Promise<boolean> {
    if (!this.whatsAppQueue) return false;

    try {
      const jobId = `wa_${notificationId}`;
      const job = await this.whatsAppQueue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        // Only remove if still waiting/delayed — do not cancel already-processing jobs
        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
          this.logger.log(
            `[WhatsApp Queue] Removed pending job '${jobId}' (was ${state})`,
          );
          return true;
        }
      }
      return false;
    } catch (err: any) {
      this.logger.warn(
        `[WhatsApp Queue] Error removing job for notification '${notificationId}': ${err.message}`,
      );
      return false;
    }
  }
}
