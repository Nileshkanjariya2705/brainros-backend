import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwoFactorConfig } from '../config/two-factor.config';
import {
  ITwoFactorProvider,
  OtpPurpose,
  TwoFactorProviderResult,
  TwoFactorSessionData,
} from './two-factor.provider.interface';

@Injectable()
export class RealTwoFactorProvider implements ITwoFactorProvider {
  readonly providerName = 'REAL' as const;
  private readonly logger = new Logger(RealTwoFactorProvider.name);
  private readonly baseUrl = 'https://control.msg91.com/api/v5/otp';

  constructor(
    private readonly configService: ConfigService,
    private readonly config: TwoFactorConfig,
  ) {}

  /**
   * Retrieves MSG91 Auth Key from config or environment.
   */
  private getAuthKey(): string {
    const authKey =
      this.config.msg91AuthKey ||
      this.configService.get<string>('MSG91_AUTH_KEY') ||
      this.configService.get<string>('OTP_API_KEY') ||
      process.env.MSG91_AUTH_KEY ||
      '567446A9gJtDpx6a9a2e53P1';

    if (!authKey) {
      this.logger.error('MSG91 Auth Key is missing in configuration.');
      throw new InternalServerErrorException(
        'MSG91 OTP provider is not properly configured.',
      );
    }
    return authKey.trim();
  }

  /**
   * Formats a mobile number for MSG91 (sanitizes and requires country code without +, default 91 if missing).
   */
  public formatMobileForMsg91(mobileNumber: string): string {
    const digits = mobileNumber.replace(/\D/g, '');
    if (digits.length === 10) {
      return `91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return digits;
    }
    if (digits.startsWith('91')) {
      return digits;
    }
    return digits.length > 10 ? digits : `91${digits}`;
  }

  /**
   * Sends OTP via MSG91 OTP v5 API
   * POST https://control.msg91.com/api/v5/otp
   */
  async sendOtp(
    mobileNumber: string,
    purpose: OtpPurpose,
  ): Promise<TwoFactorProviderResult> {
    const authKey = this.getAuthKey();
    const formattedMobile = this.formatMobileForMsg91(mobileNumber);

    const queryParams = new URLSearchParams({
      mobile: formattedMobile,
      otp_length: String(this.config.otpLength || 5),
      otp_expiry: String(Math.ceil((this.config.otpTtl || 300) / 60)),
      realTimeResponse: '1',
    });

    if (this.config.msg91TemplateId) {
      queryParams.set('template_id', this.config.msg91TemplateId);
    }

    const url = `${this.baseUrl}?${queryParams.toString()}`;

    try {
      this.logger.log(
        `[MSG91 OTP] Sending OTP via MSG91 to destination with purpose: ${purpose}`,
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const resData = (await response.json()) as {
        type?: string;
        message?: string;
        request_id?: string;
      };

      const isSuccess =
        response.ok &&
        (resData.type === 'success' ||
          (resData.message &&
            resData.message.toLowerCase().includes('success')));

      if (!isSuccess) {
        this.logger.error(
          `[MSG91_SEND_FAILED] MSG91 Send OTP failed. Response: ${JSON.stringify(resData)}`,
        );
        throw new BadRequestException(
          resData.message || 'Failed to send OTP via MSG91. Check mobile number.',
        );
      }

      this.logger.log(
        `[MSG91 OTP] OTP SMS sent successfully via MSG91 (Request ID: ${resData.request_id || 'N/A'}).`,
      );

      return {
        sessionId: formattedMobile,
        providerManaged: true,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `[MSG91_SEND_FAILED] Connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'OTP service unavailable. Please try again.',
      );
    }
  }

  /**
   * Verifies OTP code via MSG91 OTP v5 API
   * GET https://control.msg91.com/api/v5/otp/verify
   *
   * SECURITY RULE: Never accepts bypass codes in real mode.
   */
  async verifyOtp(
    targetMobileOrSession: string,
    otp: string,
    purpose: OtpPurpose,
    sessionData?: TwoFactorSessionData,
  ): Promise<boolean> {
    const authKey = this.getAuthKey();
    const formattedMobile = this.formatMobileForMsg91(targetMobileOrSession);

    const queryParams = new URLSearchParams({
      mobile: formattedMobile,
      otp: otp.trim(),
    });

    const url = `${this.baseUrl}/verify?${queryParams.toString()}`;

    try {
      this.logger.log(
        `[MSG91 OTP] Verifying OTP with MSG91 for purpose: ${purpose}`,
      );

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          authkey: authKey,
        },
      });

      const resData = (await response.json()) as {
        type?: string;
        message?: string;
      };

      const isSuccess =
        response.ok &&
        (resData.type === 'success' ||
          (resData.message &&
            (resData.message.toLowerCase().includes('success') ||
              resData.message.toLowerCase().includes('verified'))));

      if (isSuccess) {
        this.logger.log(`[MSG91 OTP] Verification succeeded.`);
        return true;
      }

      this.logger.warn(
        `[MSG91_VERIFY_FAILED] Verification rejected. Type: ${resData.type}, Message: ${resData.message}`,
      );
      return false;
    } catch (err) {
      this.logger.error(
        `[MSG91_VERIFY_FAILED] MSG91 Verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'OTP service unavailable. Please try again.',
      );
    }
  }

  /**
   * Retries / Resends OTP via MSG91 OTP Retry API
   * GET https://control.msg91.com/api/v5/otp/retry
   */
  async retryOtp(
    mobileNumber: string,
    retryType: 'text' | 'voice' = 'text',
  ): Promise<boolean> {
    const authKey = this.getAuthKey();
    const formattedMobile = this.formatMobileForMsg91(mobileNumber);

    const queryParams = new URLSearchParams({
      mobile: formattedMobile,
      retrytype: retryType,
    });

    const url = `${this.baseUrl}/retry?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          authkey: authKey,
        },
      });

      const resData = (await response.json()) as {
        type?: string;
        message?: string;
      };

      return response.ok && resData.type === 'success';
    } catch (err) {
      this.logger.warn(
        `[MSG91_RETRY_FAILED] Retry failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Resend OTP via MSG91 (alias for retryOtp)
   */
  async resendOtp(
    mobileNumber: string,
    retryType: 'text' | 'voice' = 'text',
  ): Promise<boolean> {
    return this.retryOtp(mobileNumber, retryType);
  }
}
