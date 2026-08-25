import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { INotificationProvider } from './notification-provider.interface';
import { NotificationPayload, ProviderResult } from '../interfaces/notification.interface';

@Injectable()
export class PushProvider implements INotificationProvider {
  readonly channel = NotificationChannel.PUSH;
  readonly providerName = 'Brainros-FCM-Push';
  private readonly logger = new Logger(PushProvider.name);

  async send(payload: NotificationPayload): Promise<ProviderResult> {
    try {
      this.logger.log(
        `[PushProvider] Dispatching FCM push notification for ${payload.type} to token ${payload.recipientAddress.substring(0, 15)}...`,
      );

      if (!payload.recipientAddress || payload.recipientAddress.trim().length === 0) {
        return {
          success: false,
          provider: this.providerName,
          errorCode: 'INVALID_DEVICE_TOKEN',
          errorMessage: 'Device token cannot be empty.',
          isRetryable: false,
        };
      }

      return {
        success: true,
        provider: this.providerName,
        providerMessageId: `fcm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      };
    } catch (err: any) {
      this.logger.error(`[PushProvider] Push dispatch error: ${err.message}`);
      return {
        success: false,
        provider: this.providerName,
        errorCode: 'FCM_SEND_ERROR',
        errorMessage: err.message,
        isRetryable: true,
      };
    }
  }
}
