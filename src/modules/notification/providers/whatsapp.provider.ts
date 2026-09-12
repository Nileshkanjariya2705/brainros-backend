import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { INotificationProvider } from './notification-provider.interface';
import {
  NotificationPayload,
  ProviderResult,
} from '../interfaces/notification.interface';
import {
  normalizeToWhatsApp,
  normalizeToE164,
  isValidE164,
  maskPhone,
} from '../utils/phone-normalizer.util';

/**
 * Twilio-backed WhatsApp notification provider.
 *
 * This provider is SEPARATE from the Twilio Verify OTP provider used for login.
 * - OTP / 2FA:   uses TWILIO_VERIFY_SERVICE_SID  (NOT touched here)
 * - WhatsApp:    uses TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM
 *
 * Supports:
 * - Twilio Content Template SIDs (production approved templates via CONTENT_SID env vars)
 * - Free-form text fallback (Twilio Sandbox / development only)
 *
 * SECURITY:
 * - Never logs Auth Token, OTP, JWT, or full phone numbers
 * - Classifies Twilio error codes to determine retryable vs permanent failures
 */
@Injectable()
export class WhatsAppProvider implements INotificationProvider {
  readonly channel = NotificationChannel.WHATSAPP;
  readonly providerName = 'Twilio-WhatsApp';
  private readonly logger = new Logger(WhatsAppProvider.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Twilio error codes that represent permanent, non-retryable failures.
   * See: https://www.twilio.com/docs/api/errors
   */
  private static readonly PERMANENT_ERROR_CODES = new Set([
    21211, // Invalid 'To' phone number
    21614, // 'To' number is not a valid mobile number
    21408, // Permission to send an SMS has not been enabled for the region
    21610, // Attempt to send to unsubscribed recipient
    21612, // The 'To' phone number is not currently reachable
    63003, // Channel could not authenticate the request
    63005, // Channel failed to deliver the message
    63007, // WhatsApp account is not registered
    63016, // Message not created — template not found or not approved
    63021, // WhatsApp template params count mismatch
    30003, // Unreachable destination handset
    30005, // Unknown destination handset
    30006, // Landline or unreachable carrier
    30007, // Message filtered by carrier
    30008, // Unknown error (permanent)
  ]);

  /**
   * Build the Twilio client using Auth Token (preferred) or API Key+Secret (fallback).
   * The Auth Token is read at call time (not cached) to allow runtime reconfiguration.
   */
  private buildClient() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require('twilio');

    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    if (!accountSid) {
      throw new Error('TWILIO_ACCOUNT_SID is not configured.');
    }

    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    if (authToken && authToken.trim().length > 0) {
      return twilio(accountSid, authToken.trim());
    }

    // Fallback: API Key + Secret (same credentials used by Verify OTP)
    const apiKey = this.configService.get<string>('TWILIO_API_KEY');
    const apiSecret = this.configService.get<string>('TWILIO_API_SECRET');
    if (apiKey && apiSecret) {
      return twilio(apiKey.trim(), apiSecret.trim(), { accountSid });
    }

    throw new Error(
      'No Twilio authentication configured. Set TWILIO_AUTH_TOKEN or TWILIO_API_KEY + TWILIO_API_SECRET.',
    );
  }

  /**
   * Resolve the WhatsApp FROM number from config.
   */
  private getFrom(): string {
    const from =
      this.configService.get<string>('TWILIO_WHATSAPP_FROM') ||
      'whatsapp:+14155238886'; // Twilio Sandbox fallback
    // Normalize: ensure it starts with whatsapp:
    if (!from.startsWith('whatsapp:')) {
      const e164 = normalizeToE164(from);
      return e164 ? `whatsapp:${e164}` : from;
    }
    return from;
  }

  /**
   * Resolve Content Template SID for a given notification type.
   * Returns undefined if no SID is configured (falls back to free-form text).
   */
  private getContentSidForType(
    type: NotificationType,
    reminderType?: string,
  ): string | undefined {
    // Use reminderType to distinguish 24H vs 1H exam reminders
    if (type === NotificationType.EXAM_REMINDER) {
      if (reminderType === 'EXAM_REMINDER_1H') {
        const sid = this.configService.get<string>(
          'TWILIO_WHATSAPP_EXAM_REMINDER_1H_CONTENT_SID',
        );
        return sid?.trim() || undefined;
      }
      // Default: 24H
      const sid = this.configService.get<string>(
        'TWILIO_WHATSAPP_EXAM_REMINDER_24H_CONTENT_SID',
      );
      return sid?.trim() || undefined;
    }

    if (type === NotificationType.EXAM_RESULT_PUBLISHED) {
      const sid = this.configService.get<string>(
        'TWILIO_WHATSAPP_RESULT_PUBLISHED_CONTENT_SID',
      );
      return sid?.trim() || undefined;
    }

    return undefined;
  }

  async send(payload: NotificationPayload): Promise<ProviderResult> {
    const requestTime = new Date();

    try {
      // 1. Normalize recipient phone to Twilio WhatsApp format
      const whatsappTo = normalizeToWhatsApp(payload.recipientAddress);
      const e164 = normalizeToE164(payload.recipientAddress);

      if (!whatsappTo || !e164 || !isValidE164(e164)) {
        this.logger.warn(
          `[WhatsApp] Invalid or missing phone for notification '${payload.notificationId}': ${maskPhone(payload.recipientAddress)}`,
        );
        return {
          success: false,
          provider: this.providerName,
          errorCode: 'INVALID_PHONE',
          errorMessage: `Invalid phone number format: ${maskPhone(payload.recipientAddress)}`,
          isRetryable: false,
        };
      }

      const from = this.getFrom();
      const reminderType = payload.variables?.reminderType as string | undefined;
      const contentSid = this.getContentSidForType(payload.type, reminderType);

      this.logger.log(
        `[WhatsApp] Sending ${payload.type} to ${maskPhone(whatsappTo)} via ${contentSid ? 'Content Template' : 'free-form text'}`,
      );

      const client = this.buildClient();

      let messageOptions: Record<string, any>;

      if (contentSid) {
        // Production: Twilio Content Template (pre-approved WhatsApp Business template)
        const contentVariables = this.buildContentVariables(payload);
        messageOptions = {
          from,
          to: whatsappTo,
          contentSid,
          contentVariables: JSON.stringify(contentVariables),
        };
      } else {
        // Development / Sandbox: free-form text (rendered from template or variables)
        const body = this.buildFreeFormBody(payload);
        if (!body) {
          return {
            success: false,
            provider: this.providerName,
            errorCode: 'EMPTY_MESSAGE_BODY',
            errorMessage: 'Cannot send WhatsApp: message body is empty.',
            isRetryable: false,
          };
        }
        messageOptions = {
          from,
          to: whatsappTo,
          body,
        };
      }

      const message = await client.messages.create(messageOptions);

      this.logger.log(
        `[WhatsApp] Message sent successfully. SID: ${message.sid}, Status: ${message.status}, To: ${maskPhone(whatsappTo)}`,
      );

      return {
        success: true,
        provider: this.providerName,
        providerMessageId: message.sid,
      };
    } catch (err: any) {
      return this.handleTwilioError(err, payload);
    }
  }

  /**
   * Build the content variables map for Twilio Content Template.
   * Variables are positional: { "1": value1, "2": value2, ... }
   * Adjust mapping per your approved template variable order.
   */
  private buildContentVariables(payload: NotificationPayload): Record<string, string> {
    const v = payload.variables || {};
    return {
      '1': String(v.studentName || v.name || 'Student'),
      '2': String(v.examName || v.examTitle || ''),
      '3': String(v.examTarget || v.examTargetName || ''),
      '4': String(v.examDate || ''),
      '5': String(v.examStartTime || ''),
      '6': String(v.resultLink || ''),
    };
  }

  /**
   * Build a free-form text body for Sandbox/dev sending.
   * Uses the pre-rendered `body` from NotificationService if available,
   * otherwise falls back to constructing from variables.
   */
  private buildFreeFormBody(payload: NotificationPayload): string | null {
    // If NotificationService already rendered a template body, use it
    if (payload.body && payload.body.trim()) {
      return payload.body.trim();
    }

    const v = payload.variables || {};
    const studentName = v.studentName || v.name || 'Student';
    const examName = v.examName || v.examTitle || 'your exam';
    const reminderType = v.reminderType as string | undefined;

    if (payload.type === NotificationType.EXAM_REMINDER) {
      if (reminderType === 'EXAM_REMINDER_1H') {
        return (
          `Hello ${studentName}, your ${examName} exam starts at ${v.examStartTime || 'the scheduled time'} today. ` +
          `This is a reminder that your exam starts in 1 hour. Please log in and be ready on time. – Brainros`
        );
      }
      // 24H
      return (
        `Hello ${studentName}, your ${examName} exam is scheduled for ${v.examDate || 'the upcoming date'} at ${v.examStartTime || 'the scheduled time'}. ` +
        `This is a reminder that your exam starts in 24 hours. Please be ready before the scheduled start time. – Brainros`
      );
    }

    if (payload.type === NotificationType.EXAM_RESULT_PUBLISHED) {
      const resultLink = v.resultLink || '';
      const linkPart = resultLink ? ` View your result at: ${resultLink}` : '';
      return (
        `Hello ${studentName}, your ${examName} result has been published. ` +
        `You can now view your result and performance analysis in Brainros.${linkPart} – Brainros`
      );
    }

    // Generic fallback
    return payload.body || null;
  }

  /**
   * Classify and handle Twilio API errors.
   * Returns a ProviderResult with appropriate retryability.
   */
  private handleTwilioError(err: any, payload: NotificationPayload): ProviderResult {
    const errorCode: number | undefined = err?.code;
    const errorMessage: string = err?.message || 'Unknown Twilio error';
    const httpStatus: number | undefined = err?.status;

    // Log error — do NOT log Auth Token, phone, or OTP data
    this.logger.error(
      `[WhatsApp] Twilio API error for notification '${payload.notificationId}': ` +
        `code=${errorCode}, status=${httpStatus}, message=${errorMessage}`,
    );

    // Permanent failures — no point retrying
    const isPermanent =
      (errorCode !== undefined && WhatsAppProvider.PERMANENT_ERROR_CODES.has(errorCode)) ||
      (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429);

    return {
      success: false,
      provider: this.providerName,
      errorCode: String(errorCode || httpStatus || 'TWILIO_ERROR'),
      errorMessage,
      isRetryable: !isPermanent,
    };
  }
}
