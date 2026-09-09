import { Injectable, Logger } from '@nestjs/common';
import { TwilioOtpService } from './twilio-otp.service';
import {
  ITwoFactorProvider,
  OtpPurpose,
  TwoFactorProviderResult,
  TwoFactorSessionData,
} from './two-factor.provider.interface';

@Injectable()
export class TwilioVerifyProvider implements ITwoFactorProvider {
  readonly providerName = 'REAL' as const;
  private readonly logger = new Logger(TwilioVerifyProvider.name);

  constructor(private readonly twilioOtpService: TwilioOtpService) {}

  /**
   * Sends OTP via Twilio Verify API
   */
  async sendOtp(
    destination: string,
    purpose: OtpPurpose,
  ): Promise<TwoFactorProviderResult> {
    this.logger.log(
      `[Twilio Verify Provider] Sending OTP to destination for purpose: ${purpose}`,
    );

    const result = await this.twilioOtpService.sendVerification(
      destination,
      'sms',
    );

    return {
      sessionId: result.sessionId,
      providerManaged: true,
    };
  }

  /**
   * Verifies OTP code using Twilio Verify Check API
   */
  async verifyOtp(
    destination: string,
    otp: string,
    purpose: OtpPurpose,
    sessionData?: TwoFactorSessionData,
  ): Promise<boolean> {
    this.logger.log(
      `[Twilio Verify Provider] Checking OTP for destination for purpose: ${purpose}`,
    );

    // Explicitly verify through Twilio Verify Check API
    return this.twilioOtpService.checkVerification(destination, otp);
  }

  /**
   * Resends OTP via Twilio Verify
   */
  async resendOtp(
    destination: string,
    channel: 'sms' | 'whatsapp' = 'sms',
  ): Promise<boolean> {
    const result = await this.twilioOtpService.sendVerification(
      destination,
      channel,
    );
    return Boolean(result.sessionId);
  }
}
