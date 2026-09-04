import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailAttachment {
  filename: string;
  content: Buffer | string; // Buffer or base64 string
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  from?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  isRetryable: boolean;
}

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly apiKey: string;
  private readonly defaultFrom: string;
  private readonly resendApiUrl = 'https://api.resend.com/emails';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('EMAIL_API_KEY') || process.env.EMAIL_API_KEY || '';
    this.defaultFrom =
      this.configService.get<string>('EMAIL_FROM') ||
      process.env.EMAIL_FROM ||
      'Brainros <onboarding@resend.dev>';

    if (!this.apiKey) {
      this.logger.warn('[ResendEmailService] EMAIL_API_KEY is not configured. Outgoing emails will fail.');
    }
  }

  /**
   * Dispatches an email via Resend API.
   * Never throws uncaught exceptions; returns structured SendEmailResult.
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const { to, subject, html, text, attachments, from } = options;

    if (!to || !to.includes('@')) {
      return {
        success: false,
        error: `Invalid destination email address: '${to}'`,
        isRetryable: false,
      };
    }

    if (!this.apiKey) {
      this.logger.error('[ResendEmailService] Cannot send email: EMAIL_API_KEY is missing');
      return {
        success: false,
        error: 'EMAIL_API_KEY is not configured on the server',
        isRetryable: false,
      };
    }

    try {
      const payload: Record<string, any> = {
        from: from || this.defaultFrom,
        to: [to.trim()],
        subject,
        html,
      };

      if (text) {
        payload.text = text;
      }

      if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map((att) => ({
          filename: att.filename,
          content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
        }));
      }

      this.logger.log(`[ResendEmailService] Sending email to ${to} | Subject: "${subject}"`);

      const response = await fetch(this.resendApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = responseData?.message || responseData?.error || `HTTP ${response.status} ${response.statusText}`;
        const isRetryable = response.status >= 500 || response.status === 429;

        this.logger.error(`[ResendEmailService] Resend API error (${response.status}): ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          isRetryable,
        };
      }

      const messageId = responseData?.id || `resend_${Date.now()}`;
      this.logger.log(`[ResendEmailService] Email successfully delivered to ${to} (MessageId: ${messageId})`);

      return {
        success: true,
        messageId,
        isRetryable: false,
      };
    } catch (err: any) {
      this.logger.error(`[ResendEmailService] Network/Unexpected error sending to ${to}: ${err.message}`);
      return {
        success: false,
        error: err.message || 'Unknown network error during email dispatch',
        isRetryable: true,
      };
    }
  }
}
