import { Injectable } from '@nestjs/common';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { OtpPurpose } from '../two-factor/two-factor.provider.interface';
import { RealTwoFactorProvider } from '../two-factor/real-two-factor.provider';

export type { OtpPurpose };

/**
 * OtpService acts as the primary facade for OTP operations across the application,
 * cleanly delegating all OTP challenge generation and verification to the centralized
 * TwoFactorService and underlying MSG91 / 2Factor providers.
 *
 * This ensures that all legacy, student, and authentication callers adhere strictly to
 * the server-side environment configuration without duplicate logic or hardcoded bypasses.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly twoFactorService: TwoFactorService,
    private readonly realTwoFactorProvider: RealTwoFactorProvider,
  ) {}

  /**
   * Normalizes mobile numbers to E.164 standard format (+91...)
   */
  normalizeMobileNumber(mobileNumber: string): string {
    return this.twoFactorService.normalizeMobileNumber(mobileNumber);
  }

  /**
   * Sends an OTP or creates an OTP challenge based on server ENABLE_2FA configuration.
   */
  async sendOtp(
    rawMobileNumber: string,
    purpose: OtpPurpose = 'LOGIN',
    requestContext?: {
      ipAddress?: string;
      userAgent?: string;
      userId?: string;
    },
  ): Promise<{ expiresIn: number; resendAvailableIn: number }> {
    return this.twoFactorService.sendOtp(
      rawMobileNumber,
      purpose,
      requestContext,
    );
  }

  /**
   * Verifies an OTP code using the active provider (Real or Development).
   */
  async verifyOtp(
    rawMobileNumber: string,
    otp: string,
    purpose: OtpPurpose = 'LOGIN',
    requestContext?: {
      ipAddress?: string;
      userAgent?: string;
      userId?: string;
    },
  ): Promise<boolean> {
    return this.twoFactorService.verifyOtp(
      rawMobileNumber,
      otp,
      purpose,
      requestContext,
    );
  }

  /**
   * Resends OTP using active provider (MSG91 / 2Factor retry endpoint).
   */
  async resendOtp(
    rawMobileNumber: string,
    retryType: 'text' | 'voice' = 'text',
  ): Promise<boolean> {
    return this.twoFactorService.resendOtp(rawMobileNumber, retryType);
  }

  /**
   * Direct MSG91 OTP sender (formats mobile with default 91 and calls MSG91 API).
   */
  async sendMsg91Otp(mobileNumber: string, purpose: OtpPurpose = 'LOGIN') {
    return this.realTwoFactorProvider.sendOtp(mobileNumber, purpose);
  }

  /**
   * Direct MSG91 OTP verifier.
   */
  async verifyMsg91Otp(
    mobileNumber: string,
    otp: string,
    purpose: OtpPurpose = 'LOGIN',
  ) {
    return this.realTwoFactorProvider.verifyOtp(mobileNumber, otp, purpose);
  }

  /**
   * Direct MSG91 OTP resend helper.
   */
  async resendMsg91Otp(
    mobileNumber: string,
    retryType: 'text' | 'voice' = 'text',
  ) {
    return this.realTwoFactorProvider.resendOtp(mobileNumber, retryType);
  }
}

