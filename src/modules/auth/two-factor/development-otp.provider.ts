import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { TwoFactorConfig } from '../config/two-factor.config';
import {
  ITwoFactorProvider,
  OtpPurpose,
  TwoFactorProviderResult,
  TwoFactorSessionData,
} from './two-factor.provider.interface';

@Injectable()
export class DevelopmentOtpProvider implements ITwoFactorProvider {
  readonly providerName = 'DEVELOPMENT' as const;
  private readonly logger = new Logger(DevelopmentOtpProvider.name);

  constructor(private readonly config: TwoFactorConfig) {}

  private hashOtp(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Creates a local development OTP challenge without calling any external provider.
   * NEVER sends SMS, WhatsApp, email, or calls external APIs.
   */
  async sendOtp(
    destination: string,
    purpose: OtpPurpose,
  ): Promise<TwoFactorProviderResult> {
    const expectedOtp = this.config.devBypassOtp;
    const otpHash = this.hashOtp(expectedOtp);

    // Explicitly do NOT log the OTP value itself to prevent sensitive data leakage
    this.logger.log(
      `[2FA mode: DEVELOPMENT] Local OTP challenge generated for destination with purpose: ${purpose}`,
    );

    return {
      sessionId: `dev-session-${Date.now()}`,
      providerManaged: false,
      otpHash,
    };
  }

  /**
   * Verifies the user-entered OTP locally against the configured development bypass OTP.
   */
  async verifyOtp(
    destination: string,
    otp: string,
    purpose: OtpPurpose,
    sessionData?: TwoFactorSessionData,
  ): Promise<boolean> {
    this.logger.log(
      `[2FA mode: DEVELOPMENT] Verifying OTP locally for purpose: ${purpose}`,
    );

    const cleanOtp = (otp || '').trim();
    const expectedOtp = (this.config.devBypassOtp || '12345').trim();

    // Default development OTP bypass (12345)
    if (cleanOtp === expectedOtp || cleanOtp === '12345') {
      return true;
    }

    // Check against session hash if available
    if (sessionData?.otpHash) {
      const submittedHash = this.hashOtp(cleanOtp);
      return crypto.timingSafeEqual(
        Buffer.from(submittedHash),
        Buffer.from(sessionData.otpHash),
      );
    }

    return false;
  }
}
