import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationQueueService } from '../../notification/queues/notification-queue.service';
import { NotificationPreferenceService } from '../../notification/services/notification-preference.service';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import {
  WHATSAPP_REMINDER_QUEUE_NAME,
  WhatsAppReminderType,
} from '../../notification/interfaces/exam-notification-job.interface';
import { maskPhone } from '../../notification/utils/phone-normalizer.util';

const IST_TIMEZONE = 'Asia/Kolkata';

/** Format a Date to "15 Sep 2026" in IST */
function formatDateIST(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: IST_TIMEZONE,
  });
}

/** Format a Date to "10:00 AM" in IST */
function formatTimeIST(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: IST_TIMEZONE,
  });
}

/**
 * ScheduleReminderService
 *
 * Manages WhatsApp exam reminder scheduling via BullMQ delayed jobs.
 *
 * Architecture:
 *   ExamScheduleService (after tx commit)
 *       ↓
 *   ScheduleReminderService.scheduleExamWhatsAppReminders()
 *       ↓
 *   Notification records (status=QUEUED) + BullMQ delayed jobs
 *       ↓ [at reminder time]
 *   WhatsAppReminderProcessor
 *       ↓
 *   WhatsAppProvider → Twilio API
 *
 * Key guarantees:
 * - Uses BullMQ delayed jobs (NOT setTimeout/in-memory timers) — survives restarts
 * - Idempotent: uses unique Notification.idempotencyKey + BullMQ jobId
 * - Filters students by exam target eligibility
 * - Respects user WhatsApp notification preferences
 * - Handles reschedule: cancels old jobs, creates new delayed jobs
 * - Handles cancellation: removes pending jobs
 * - Never affects exam state on failure
 */
@Injectable()
export class ScheduleReminderService {
  private readonly logger = new Logger(ScheduleReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly preferenceService: NotificationPreferenceService,
    @InjectQueue(WHATSAPP_REMINDER_QUEUE_NAME)
    private readonly whatsAppQueue: Queue,
  ) {}

  /**
   * Schedule WhatsApp exam reminder jobs for all eligible students.
   * Called after exam scheduling transaction commits.
   *
   * Creates:
   * - 24H reminder (fires 24 hours before exam start)
   * - 1H reminder (fires 1 hour before exam start)
   *
   * @param examId Exam ID
   * @param scheduleId ExamSchedule ID (used in job IDs for idempotency)
   * @param examTargetId Target exam category (JEE/NEET/CET) — only students of this target notified
   * @param examTitle Exam display name
   * @param startTime Exam start time (UTC stored in DB)
   * @param scheduleVersion Current schedule version (for idempotency across reschedules)
   */
  async scheduleExamWhatsAppReminders(params: {
    examId: string;
    scheduleId: string;
    examTargetId: string;
    examTitle: string;
    examTargetName?: string;
    startTime: Date;
    scheduleVersion?: number;
  }): Promise<void> {
    const {
      examId,
      scheduleId,
      examTargetId,
      examTitle,
      examTargetName = '',
      startTime,
      scheduleVersion = 1,
    } = params;

    const now = Date.now();
    const startMs = startTime.getTime();

    const reminderWindows: Array<{
      reminderType: WhatsAppReminderType;
      offsetMs: number;
      label: string;
    }> = [
      { reminderType: 'EXAM_REMINDER_24H', offsetMs: 24 * 60 * 60 * 1000, label: '24 hours' },
      { reminderType: 'EXAM_REMINDER_1H', offsetMs: 60 * 60 * 1000, label: '1 hour' },
    ];

    const examDate = formatDateIST(startTime);
    const examStartTime = formatTimeIST(startTime);

    // Fetch eligible students: must be in the same exam target, ACTIVE, and have a phone number
    const students = await this.prisma.student.findMany({
      where: {
        examTargetId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        userId: true,
        name: true,
        user: {
          select: {
            phone: true,
            mobileNumber: true,
          },
        },
      },
    });

    if (students.length === 0) {
      this.logger.log(
        `[WA Reminder] No eligible students for exam target '${examTargetId}'. Skipping.`,
      );
      return;
    }

    this.logger.log(
      `[WA Reminder] Scheduling WhatsApp reminders for ${students.length} students, exam '${examTitle}'`,
    );

    let scheduledCount = 0;
    let skippedCount = 0;

    for (const window of reminderWindows) {
      const fireAtMs = startMs - window.offsetMs;

      // Skip if the reminder time has already passed
      if (fireAtMs <= now) {
        this.logger.debug(
          `[WA Reminder] ${window.label} reminder window already passed for exam '${examId}'. Skipping.`,
        );
        continue;
      }

      const delayMs = fireAtMs - now;

      for (const student of students) {
        const phone = student.user?.phone || student.user?.mobileNumber;
        if (!phone) {
          this.logger.debug(
            `[WA Reminder] Student '${student.userId}' has no phone. Skipping.`,
          );
          skippedCount++;
          continue;
        }

        // Check WhatsApp notification preference for EXAM_REMINDER
        const allowed = await this.preferenceService.isNotificationAllowed(
          student.userId,
          NotificationType.EXAM_REMINDER,
          NotificationChannel.WHATSAPP,
        );
        if (!allowed) {
          this.logger.debug(
            `[WA Reminder] Student '${student.userId}' has disabled WhatsApp exam reminders. Skipping.`,
          );
          skippedCount++;
          continue;
        }

        const idempotencyKey = `wa_remind_${examId}_${scheduleId}_${student.userId}_${window.reminderType}_v${scheduleVersion}`;

        // Create Notification record (status=QUEUED) — idempotent via unique key
        let notification: any;
        try {
          notification = await this.prisma.notification.upsert({
            where: { idempotencyKey },
            update: {}, // Do not overwrite if already exists (e.g., reschedule with same version)
            create: {
              userId: student.userId,
              recipientUserId: student.userId,
              recipientAddress: phone,
              channel: NotificationChannel.WHATSAPP,
              type: NotificationType.EXAM_REMINDER,
              title: `Exam Reminder: ${examTitle}`,
              message:
                window.reminderType === 'EXAM_REMINDER_1H'
                  ? `Your ${examTitle} exam starts in 1 hour at ${examStartTime}.`
                  : `Your ${examTitle} exam starts tomorrow at ${examStartTime} (${examDate}).`,
              payload: {
                examId,
                scheduleId,
                reminderType: window.reminderType,
                examTitle,
                examTarget: examTargetName,
                examDate,
                examStartTime,
              },
              priority: NotificationPriority.HIGH,
              status: NotificationStatus.QUEUED,
              scheduledAt: new Date(fireAtMs),
              scheduleVersion,
              idempotencyKey,
            },
          });
        } catch (dbErr: any) {
          this.logger.error(
            `[WA Reminder] DB error creating notification record for student '${student.userId}': ${dbErr.message}`,
          );
          continue; // Skip this student, don't fail entire batch
        }

        // Enqueue BullMQ delayed job
        await this.notificationQueue.dispatchWhatsAppReminderJob(
          {
            notificationId: notification.id,
            recipientUserId: student.userId,
            phone,
            examId,
            examTitle,
            examTarget: examTargetName,
            examDate,
            examStartTime,
            reminderType: window.reminderType,
            studentName: student.name,
          },
          delayMs,
        );

        scheduledCount++;
      }
    }

    this.logger.log(
      `[WA Reminder] Scheduled ${scheduledCount} WhatsApp reminder job(s) for exam '${examTitle}'. Skipped: ${skippedCount}.`,
    );
  }

  /**
   * Cancel all pending WhatsApp reminder jobs for an exam schedule.
   * Called when exam is rescheduled or cancelled.
   *
   * Updates QUEUED/PENDING Notification records to CANCELLED and removes BullMQ jobs.
   *
   * @param examId Exam ID
   * @param scheduleId ExamSchedule ID (optional — if provided, only cancels this schedule's reminders)
   * @param scheduleVersion Only cancel notifications up to this version
   */
  async cancelExamWhatsAppReminders(
    examId: string,
    scheduleId?: string,
    scheduleVersion?: number,
  ): Promise<void> {
    try {
      // Find all QUEUED/PENDING WhatsApp reminder notifications for this exam
      const pendingNotifications = await this.prisma.notification.findMany({
        where: {
          channel: NotificationChannel.WHATSAPP,
          type: NotificationType.EXAM_REMINDER,
          status: { in: [NotificationStatus.QUEUED, NotificationStatus.PENDING as any] },
          payload: {
            path: ['examId'],
            equals: examId,
          },
          ...(scheduleVersion !== undefined
            ? { scheduleVersion: { lte: scheduleVersion } }
            : {}),
        },
        select: { id: true, idempotencyKey: true },
      });

      if (pendingNotifications.length === 0) {
        this.logger.debug(
          `[WA Reminder] No pending notifications to cancel for exam '${examId}'.`,
        );
        return;
      }

      this.logger.log(
        `[WA Reminder] Cancelling ${pendingNotifications.length} pending WhatsApp reminder(s) for exam '${examId}'.`,
      );

      // Remove BullMQ jobs and update DB records
      for (const notif of pendingNotifications) {
        await this.notificationQueue.removeWhatsAppReminderJob(notif.id);
      }

      // Bulk update DB to CANCELLED
      await this.prisma.notification.updateMany({
        where: {
          id: { in: pendingNotifications.map((n) => n.id) },
        },
        data: {
          status: NotificationStatus.CANCELLED,
          lastError: `Cancelled due to exam ${scheduleVersion !== undefined ? 'reschedule' : 'cancellation'}`,
        },
      });

      this.logger.log(
        `[WA Reminder] Cancelled ${pendingNotifications.length} reminder notification(s) for exam '${examId}'.`,
      );
    } catch (err: any) {
      // Log but never throw — reminder cancellation must not affect exam operations
      this.logger.error(
        `[WA Reminder] Error cancelling reminders for exam '${examId}': ${err.message}`,
      );
    }
  }

  /**
   * Handle exam rescheduling: cancel old reminders, schedule new ones.
   *
   * @param oldScheduleVersion Previous schedule version (used to cancel stale reminders)
   */
  async handleExamRescheduled(
    examId: string,
    scheduleId: string,
    examTargetId: string,
    examTitle: string,
    examTargetName: string,
    newStartTime: Date,
    oldScheduleVersion: number,
    newScheduleVersion: number,
  ): Promise<void> {
    this.logger.log(
      `[WA Reminder] Handling reschedule for exam '${examId}'. ` +
        `Old version: ${oldScheduleVersion}, New version: ${newScheduleVersion}`,
    );

    // 1. Cancel old pending reminders
    await this.cancelExamWhatsAppReminders(examId, scheduleId, oldScheduleVersion);

    // 2. Schedule new reminders for the updated time
    await this.scheduleExamWhatsAppReminders({
      examId,
      scheduleId,
      examTargetId,
      examTitle,
      examTargetName,
      startTime: newStartTime,
      scheduleVersion: newScheduleVersion,
    });
  }
}
