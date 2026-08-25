import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { INotificationProvider } from './notification-provider.interface';
import { NotificationPayload, ProviderResult } from '../interfaces/notification.interface';

@Injectable()
export class SmsProvider implements INotificationProvider {
  readonly channel = NotificationChannel.SMS;
  readonly providerName = 'Brainros-2Factor-SMS';
  private readonly logger = new Logger(SmsProvider.name);

  async send(payload: NotificationPayload): Promise<ProviderResult> {
    try {
      this.logger.log(
        `[SmsProvider] Dispatching SMS for ${payload.type} to ${payload.recipientAddress}`,
      );

      const cleanedPhone = payload.recipientAddress.replace(/[^0-9+]/g, '');
      if (cleanedPhone.length < 10) {
        return {
          success: false,
          provider: this.providerName,
          errorCode: 'INVALID_PHONE_NUMBER',
          errorMessage: `Phone number '${payload.recipientAddress}' is too short or invalid.`,
          isRetryable: false,
        };
      }

      return {
        success: true,
        provider: this.providerName,
        providerMessageId: `msg-sms-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      };
    } catch (err: any) {
      this.logger.error(`[SmsProvider] Error sending to ${payload.recipientAddress}: ${err.message}`);
      return {
        success: false,
        provider: this.providerName,
        errorCode: 'SMS_GATEWAY_TIMEOUT',
        errorMessage: err.message,
        isRetryable: true,
      };
    }
  }
}
