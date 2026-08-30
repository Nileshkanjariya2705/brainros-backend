import { NotificationChannel } from '@prisma/client';
import {
  NotificationPayload,
  ProviderResult,
} from '../interfaces/notification.interface';

export interface INotificationProvider {
  readonly channel: NotificationChannel;
  readonly providerName: string;

  send(payload: NotificationPayload): Promise<ProviderResult>;
}
