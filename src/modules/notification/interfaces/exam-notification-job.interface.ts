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
