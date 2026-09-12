import { NotificationType } from '@prisma/client';

export interface ExamNotificationJobData {
  type: NotificationType;
  examId: string;
  scheduleId?: string;
  title?: string;
  message?: string;
  metadata?: Record<string, any>;
}

export const NOTIFICATION_QUEUE_NAME = 'notification';

export const NOTIFICATION_JOB_NAMES = {
  EXAM_NOTIFICATION: 'exam-notification-job',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Reminder Queue (separate from the main notification/in-app queue)
// ─────────────────────────────────────────────────────────────────────────────

export const WHATSAPP_REMINDER_QUEUE_NAME = 'whatsapp-reminder';

export const WHATSAPP_JOB_NAMES = {
  SEND_REMINDER: 'whatsapp-send-reminder',
} as const;

/**
 * Reminder type discriminator stored in the job payload.
 * Used to select the correct Twilio Content Template SID and message body.
 */
export type WhatsAppReminderType =
  | 'EXAM_REMINDER_24H'
  | 'EXAM_REMINDER_1H'
  | 'EXAM_RESULT_PUBLISHED';

/**
 * BullMQ job payload for the whatsapp-reminder queue.
 *
 * Each job sends ONE WhatsApp message to ONE student.
 * The `notificationId` is the primary key for idempotency:
 * if the Notification record is already SENT, the job is skipped.
 */
export interface WhatsAppReminderJobData {
  /** Primary key of the Notification DB record — used for idempotency */
  notificationId: string;
  /** UserId of the recipient (for preference checks and logging) */
  recipientUserId: string;
  /** Recipient raw phone number (will be normalized by provider) */
  phone: string;
  /** Exam ID for context */
  examId: string;
  /** Exam title for message body */
  examTitle: string;
  /** Exam target name (e.g., JEE, NEET) */
  examTarget?: string;
  /** Formatted exam date (IST) — e.g., "15 Sep 2026" */
  examDate?: string;
  /** Formatted exam start time (IST) — e.g., "10:00 AM" */
  examStartTime?: string;
  /** Distinguishes 24H / 1H / result notification */
  reminderType: WhatsAppReminderType;
  /** URL to the student result page (for result published notifications) */
  resultLink?: string;
  /** Student display name for personalisation */
  studentName?: string;
}
