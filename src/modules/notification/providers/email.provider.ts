import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { INotificationProvider } from './notification-provider.interface';
import {
  NotificationPayload,
  ProviderResult,
} from '../interfaces/notification.interface';

@Injectable()
export class EmailProvider implements INotificationProvider {
  readonly channel = NotificationChannel.EMAIL;
  readonly providerName = 'Brainros-SES-Email';
  private readonly logger = new Logger(EmailProvider.name);

  async send(payload: NotificationPayload): Promise<ProviderResult> {
    try {
      this.logger.log(
        `[EmailProvider] Sending ${payload.type} to ${payload.recipientAddress} | Subject: "${payload.subject || 'Notice'}"`,
      );

      // Simulation / SES adapter logic
      if (
        !payload.recipientAddress ||
        !payload.recipientAddress.includes('@')
      ) {
        return {
          success: false,
          provider: this.providerName,
          errorCode: 'INVALID_EMAIL_ADDRESS',
          errorMessage: `Recipient address '${payload.recipientAddress}' is not a valid email format.`,
          isRetryable: false,
        };
      }

      return {
        success: true,
        provider: this.providerName,
        providerMessageId: `msg-email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      };
    } catch (err: any) {
      this.logger.error(
        `[EmailProvider] Error sending to ${payload.recipientAddress}: ${err.message}`,
      );
      return {
        success: false,
        provider: this.providerName,
        errorCode: 'EMAIL_PROVIDER_ERROR',
        errorMessage: err.message,
        isRetryable: true,
      };
    }
  }
}
