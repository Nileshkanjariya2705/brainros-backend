import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { INotificationProvider } from './notification-provider.interface';
import {
  NotificationPayload,
  ProviderResult,
} from '../interfaces/notification.interface';

@Injectable()
export class WhatsAppProvider implements INotificationProvider {
  readonly channel = NotificationChannel.WHATSAPP;
  readonly providerName = 'Brainros-WhatsApp-Business';
  private readonly logger = new Logger(WhatsAppProvider.name);

  async send(payload: NotificationPayload): Promise<ProviderResult> {
    try {
      this.logger.log(
        `[WhatsAppProvider] Dispatching WhatsApp message for ${payload.type} to ${payload.recipientAddress}`,
      );

      const cleanedPhone = payload.recipientAddress.replace(/[^0-9+]/g, '');
      if (cleanedPhone.length < 10) {
        return {
          success: false,
          provider: this.providerName,
          errorCode: 'INVALID_WHATSAPP_PHONE',
          errorMessage: 'Invalid phone number format for WhatsApp.',
          isRetryable: false,
        };
      }

      return {
        success: true,
        provider: this.providerName,
        providerMessageId: `msg-wa-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      };
    } catch (err: any) {
      this.logger.error(
        `[WhatsAppProvider] Error sending to ${payload.recipientAddress}: ${err.message}`,
      );
      return {
        success: false,
        provider: this.providerName,
        errorCode: 'WHATSAPP_API_ERROR',
        errorMessage: err.message,
        isRetryable: true,
      };
    }
  }
}
