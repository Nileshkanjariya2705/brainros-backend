import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationChannel, NotificationPriority, NotificationStatus, NotificationType } from '@prisma/client';
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
 * IDEMPOTENCY:
 * Each job carries a `notificationId` that maps to a `Notification` DB record.
 * If the record is already SENT, the job is skipped — preventing duplicate sends
 * even when BullMQ retries the job after a transient failure.
 *
 * FAILURE ISOLATION:
 * - Permanent Twilio errors (invalid phone, template issues) → status=FAILED, job completes
 * - Retryable Twilio errors (5xx, rate limit) → status=RETRYING, job throws to trigger BullMQ retry
 * - Exam/result state is NEVER affected by notification failures
 */
@Processor(WHATSAPP_REMINDER_QUEUE_NAME)
export class WhatsAppReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppProvider: WhatsAppProvider,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(
      `[WhatsApp Worker] Connection/runtime error: ${err.message}`,
    );
  }

  async process(job: Job<WhatsAppReminderJobData>): Promise<any> {
    const { notificationId, reminderType, examId, examTitle } = job.data;

    this.logger.log(
      `[WhatsApp Worker] Processing job [${job.id}] — Type: ${reminderType}, Exam: ${examId}, ` +
        `Notification: ${notificationId}, Attempt: ${(job.attemptsMade ?? 0) + 1}`,
    );

    // 1. Load the Notification record
    let notification: any;
    try {
      notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
    } catch (dbErr: any) {
      this.logger.error(
        `[WhatsApp Worker] DB error loading notification '${notificationId}': ${dbErr.message}`,
      );
      throw dbErr; // Retryable: DB may be temporarily unavailable
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
      this.logger.error(
        `[WhatsApp Worker] Failed to mark notification '${notificationId}' as PROCESSING: ${updateErr.message}`,
      );
      throw updateErr;
    }

    // 4. Build the provider payload
    const phone =
      job.data.phone || notification.recipientAddress || '';

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
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.SENT,
          sentAt: responseTime,
        },
      });

      await this.prisma.notificationLog.create({
        data: {
          notificationId,
          channel: NotificationChannel.WHATSAPP,
          provider: this.whatsAppProvider.providerName,
          providerMessageId: result.providerMessageId || null,
          attemptNumber: (job.attemptsMade ?? 0) + 1,
          status: NotificationStatus.SENT,
          requestTime,
          responseTime,
        },
      });

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
      const isRetryable = result.isRetryable !== false; // default retryable

      const newStatus = isRetryable
        ? NotificationStatus.RETRYING
        : NotificationStatus.FAILED;

      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: newStatus,
          lastError: result.errorMessage || 'WhatsApp delivery failed',
        },
      });

      await this.prisma.notificationLog.create({
        data: {
          notificationId,
          channel: NotificationChannel.WHATSAPP,
          provider: this.whatsAppProvider.providerName,
          attemptNumber: (job.attemptsMade ?? 0) + 1,
          status: NotificationStatus.FAILED,
          requestTime,
          responseTime,
          errorCode: result.errorCode || 'WHATSAPP_ERROR',
          errorMessage: result.errorMessage || 'WhatsApp delivery failed',
        },
      });

      this.logger.warn(
        `[WhatsApp Worker] ${isRetryable ? 'Retryable' : 'Permanent'} failure for notification '${notificationId}': ` +
          `code=${result.errorCode}, message=${result.errorMessage}`,
      );

      if (isRetryable) {
        // Rethrow so BullMQ schedules a retry with backoff
        throw new Error(
          `WhatsApp retryable failure [${result.errorCode}]: ${result.errorMessage}`,
        );
      }

      // Permanent failure — do NOT rethrow, job completes as failed (no further retries)
      return {
        status: 'FAILED_PERMANENT',
        notificationId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      };
    }
  }
}
