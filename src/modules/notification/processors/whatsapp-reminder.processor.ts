import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProvider } from '../providers/whatsapp.provider';
import {
  WhatsAppReminderJobData,
  WHATSAPP_REMINDER_QUEUE_NAME,
} from '../interfaces/exam-notification-job.interface';
import { maskPhone } from '../utils/phone-normalizer.util';
import { NotificationPayload } from '../interfaces/notification.interface';

/**
 * BullMQ processor for the `whatsapp-reminder` queue.
 *
 * Sends individual WhatsApp messages via Twilio for:
 * - Exam reminders (24H and 1H before exam start)
 * - Exam result publication notifications
 *
 * RATE LIMITING & CONCURRENCY:
 * - Concurrency is set to 1 and limiter to 1/sec to strictly comply with
 *   Twilio API rate limits (avoiding code 20429 errors).
 *
 * IDEMPOTENCY & LOOP PREVENTION:
 * - Checks DB status before send (skips if already SENT).
 * - Caps maximum attempts (never throws past max attempts, preventing infinite retry loops).
 * - Gracefully handles server shutdown and database disconnections without crash-looping.
 * - Permanent Twilio errors (e.g. trial unverified numbers, bad templates) fail immediately without retries.
 */
@Processor(WHATSAPP_REMINDER_QUEUE_NAME, {
  concurrency: 1,
  limiter: {
    max: 1,
    duration: 1000,
  },
})
export class WhatsAppReminderProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppProvider: WhatsAppProvider,
  ) {
    super();
  }

  async onModuleDestroy() {
    try {
      if (this.worker) {
        await this.worker.close();
      }
    } catch {}
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(
      `[WhatsApp Worker] Connection/runtime error: ${err.message}`,
    );
  }

  private isDbUnavailable(error?: any): boolean {
    if (this.prisma.shuttingDown || !this.prisma.isReady) {
      return true;
    }
    if (error) {
      const msg = error.message || String(error);
      return (
        msg.includes('Engine is not yet connected') ||
        msg.includes('Response from the Engine was empty') ||
        msg.includes('Connection closed') ||
        msg.includes('Cannot use a pool after calling end')
      );
    }
    return false;
  }

  async process(job: Job<WhatsAppReminderJobData>): Promise<any> {
    const { notificationId, reminderType, examId, examTitle } = job.data;
    const currentAttempt = (job.attemptsMade ?? 0) + 1;
    const maxAttempts = job.opts?.attempts || 3;

    // 0. Check application shutdown / database availability
    if (this.isDbUnavailable()) {
      this.logger.warn(
        `[WhatsApp Worker] Skipping job [${job.id}] — DB offline or application shutting down.`,
      );
      return { status: 'SKIPPED_SHUTDOWN', notificationId };
    }

    this.logger.log(
      `[WhatsApp Worker] Processing job [${job.id}] — Type: ${reminderType}, Exam: ${examId}, ` +
        `Notification: ${notificationId}, Attempt: ${currentAttempt}/${maxAttempts}`,
    );

    // 1. Load the Notification record
    let notification: any;
    try {
      notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
    } catch (dbErr: any) {
      if (this.isDbUnavailable(dbErr)) {
        this.logger.warn(
          `[WhatsApp Worker] DB offline while loading notification '${notificationId}'. Aborting cleanly.`,
        );
        return { status: 'ABORTED_SHUTDOWN', notificationId };
      }
      this.logger.error(
        `[WhatsApp Worker] DB error loading notification '${notificationId}': ${dbErr.message}`,
      );
      throw dbErr; // Retryable transient DB glitch
    }

    if (!notification) {
      this.logger.warn(
        `[WhatsApp Worker] Notification '${notificationId}' not found in DB. Skipping job.`,
      );
      return { status: 'SKIPPED_NOT_FOUND', notificationId };
    }

    // 2. IDEMPOTENCY CHECK: Skip if already sent (handles BullMQ retries safely)
    if (notification.status === NotificationStatus.SENT) {
      this.logger.log(
        `[WhatsApp Worker] Notification '${notificationId}' already SENT. Skipping duplicate send.`,
      );
      return { status: 'SKIPPED_ALREADY_SENT', notificationId };
    }

    // If already marked FAILED or CANCELLED, do not process
    if (
      notification.status === NotificationStatus.FAILED ||
      notification.status === NotificationStatus.CANCELLED
    ) {
      this.logger.log(
        `[WhatsApp Worker] Notification '${notificationId}' is already ${notification.status}. Skipping.`,
      );
      return { status: `SKIPPED_${notification.status}`, notificationId };
    }

    // 3. Mark as PROCESSING (atomic update, safe to retry)
    try {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });
    } catch (updateErr: any) {
      if (this.isDbUnavailable(updateErr)) {
        this.logger.warn(
          `[WhatsApp Worker] DB offline while updating '${notificationId}' to PROCESSING. Aborting.`,
        );
        return { status: 'ABORTED_SHUTDOWN', notificationId };
      }
      this.logger.error(
        `[WhatsApp Worker] Failed to mark notification '${notificationId}' as PROCESSING: ${updateErr.message}`,
      );
      throw updateErr;
    }

    // 4. Build the provider payload
    const phone = job.data.phone || notification.recipientAddress || '';

    const notificationPayload: NotificationPayload = {
      notificationId,
      recipientUserId: notification.recipientUserId || job.data.recipientUserId,
      recipientAddress: phone,
      channel: NotificationChannel.WHATSAPP,
      type: notification.type || NotificationType.EXAM_REMINDER,
      body: notification.message || '',
      variables: {
        ...(notification.payload || {}),
        studentName: job.data.studentName,
        examName: examTitle,
        examTitle,
        examTarget: job.data.examTarget,
        examDate: job.data.examDate,
        examStartTime: job.data.examStartTime,
        reminderType,
        resultLink: job.data.resultLink,
      },
      priority: notification.priority || NotificationPriority.HIGH,
    };

    const requestTime = new Date();

    // 5. Call WhatsApp provider (Twilio API)
    const result = await this.whatsAppProvider.send(notificationPayload);
    const responseTime = new Date();

    if (result.success) {
      // 6a. Success path
      try {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.SENT,
            sentAt: responseTime,
            lastError: null,
          },
        });

        await this.prisma.notificationLog.create({
          data: {
            notificationId,
            channel: NotificationChannel.WHATSAPP,
            provider: this.whatsAppProvider.providerName,
            providerMessageId: result.providerMessageId || null,
            attemptNumber: currentAttempt,
            status: NotificationStatus.SENT,
            requestTime,
            responseTime,
          },
        });
      } catch (dbErr: any) {
        if (!this.isDbUnavailable(dbErr)) {
          this.logger.warn(
            `[WhatsApp Worker] Warning logging success for '${notificationId}': ${dbErr.message}`,
          );
        }
      }

      this.logger.log(
        `[WhatsApp Worker] Successfully sent ${reminderType} to ${maskPhone(phone)}. ` +
          `Twilio SID: ${result.providerMessageId}`,
      );

      return {
        status: 'SENT',
        notificationId,
        providerMessageId: result.providerMessageId,
      };
    } else {
      // 6b. Failure path
      const isRetryable = result.isRetryable !== false;
      const hasExhaustedRetries = currentAttempt >= maxAttempts;

      // When retries are exhausted or failure is permanent, status is FAILED
      const newStatus =
        isRetryable && !hasExhaustedRetries
          ? NotificationStatus.RETRYING
          : NotificationStatus.FAILED;

      try {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status: newStatus,
            lastError: (result.errorMessage || 'WhatsApp delivery failed').slice(0, 1000),
          },
        });

        await this.prisma.notificationLog.create({
          data: {
            notificationId,
            channel: NotificationChannel.WHATSAPP,
            provider: this.whatsAppProvider.providerName,
            attemptNumber: currentAttempt,
            status: NotificationStatus.FAILED,
            requestTime,
            responseTime,
            errorCode: (result.errorCode || 'WHATSAPP_ERROR').slice(0, 50),
            errorMessage: (result.errorMessage || 'WhatsApp delivery failed').slice(0, 1000),
          },
        });
      } catch (dbErr: any) {
        if (this.isDbUnavailable(dbErr)) {
          return { status: 'ABORTED_SHUTDOWN', notificationId };
        }
        this.logger.warn(
          `[WhatsApp Worker] Could not write failure log for '${notificationId}': ${dbErr.message}`,
        );
      }

      this.logger.warn(
        `[WhatsApp Worker] ${isRetryable && !hasExhaustedRetries ? 'Retryable' : 'Permanent'} failure for notification '${notificationId}' (Attempt ${currentAttempt}/${maxAttempts}): ` +
          `code=${result.errorCode}, message=${result.errorMessage}`,
      );

      // Only rethrow if it is retryable AND we haven't reached max attempts
      if (isRetryable && !hasExhaustedRetries) {
        throw new Error(
          `WhatsApp retryable failure [${result.errorCode}]: ${result.errorMessage}`,
        );
      }

      // Permanent failure or max retries reached: COMPLETE the job cleanly (NO loop)
      return {
        status: hasExhaustedRetries ? 'FAILED_MAX_RETRIES' : 'FAILED_PERMANENT',
        notificationId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      };
    }
  }
}
