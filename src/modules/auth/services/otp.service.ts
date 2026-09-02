import { Injectable } from '@nestjs/common';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { OtpPurpose } from '../two-factor/two-factor.provider.interface';

export type { OtpPurpose };

/**
 * OtpService acts as the primary facade for OTP operations across the application,
 * cleanly delegating all OTP challenge generation and verification to the centralized
 * TwoFactorService.
 *
 * This ensures that all legacy, student, and authentication callers adhere strictly to
 * the ENABLE_2FA environment configuration without duplicate logic or hardcoded bypasses.
 */
@Injectable()
export class OtpService {
  constructor(private readonly twoFactorService: TwoFactorService) {}

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
    purpose: OtpPurpose,
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
    purpose: OtpPurpose,
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
}
