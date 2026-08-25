import {
  NotificationChannel,
  NotificationType,
  NotificationStatus,
  NotificationPriority,
} from '@prisma/client';

export interface NotificationPayload {
  notificationId: string;
  recipientUserId?: string | null;
  recipientAddress: string;
  channel: NotificationChannel;
  type: NotificationType;
  subject?: string;
  body: string;
  variables?: Record<string, any>;
  priority?: NotificationPriority;
  correlationId?: string;
  idempotencyKey?: string;
  scheduleVersion?: number;
}

export interface ProviderResult {
  success: boolean;
  provider: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  isRetryable?: boolean;
}

export interface SendNotificationOptions {
  recipientUserId?: string;
  recipientAddress: string;
  channel: NotificationChannel;
  type: NotificationType;
  variables: Record<string, any>;
  languageCode?: string;
  priority?: NotificationPriority;
  scheduledAt?: Date;
  expiresAt?: Date;
  correlationId?: string;
  idempotencyKey?: string;
  scheduleVersion?: number;
}
