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
export class TwoFactorDotInProvider implements ITwoFactorProvider {
  readonly providerName = 'REAL' as const;
  private readonly logger = new Logger(TwoFactorDotInProvider.name);
  private readonly baseUrl = 'https://2factor.in/API/V1';

  constructor(
    private readonly configService: ConfigService,
    private readonly config: TwoFactorConfig,
  ) {}

  /**
   * Retrieves the 2Factor.in API Key from config or environment.
   */
  private getApiKey(): string {
    const apiKey =
      this.config.twoFactorApiKey ||
      this.configService.get<string>('TWO_FACTOR_API_KEY') ||
      this.configService.get<string>('TWOFACTOR_API_KEY') ||
      process.env.TWO_FACTOR_API_KEY ||
      '749e2f32-9fd7-11f1-9cb1-0200cd936042';

    if (!apiKey) {
      this.logger.error('2Factor.in API Key is missing in configuration.');
      throw new InternalServerErrorException(
        '2Factor OTP provider is not properly configured.',
      );
    }
    return apiKey.trim();
  }

  /**
   * Formats a mobile number for 2Factor.in (digits only, including country code).
   * E.g., +919876543210 becomes 919876543210
   */
  public formatMobileFor2Factor(mobileNumber: string): string {
    return mobileNumber.replace(/\D/g, '');
  }

  /**
   * Sends OTP via 2Factor.in SMS API
   * GET https://2factor.in/API/V1/{api_key}/SMS/{phone_number}/AUTOGEN
   */
  async sendOtp(
    mobileNumber: string,
    purpose: OtpPurpose,
  ): Promise<TwoFactorProviderResult> {
    const apiKey = this.getApiKey();
    const formattedMobile = this.formatMobileFor2Factor(mobileNumber);
    const templateName = this.config.twoFactorTemplateName ? this.config.twoFactorTemplateName.trim() : '';
    const url = templateName 
      ? `${this.baseUrl}/${apiKey}/SMS/${formattedMobile}/AUTOGEN/${templateName}`
      : `${this.baseUrl}/${apiKey}/SMS/${formattedMobile}/AUTOGEN`;

    const maskedUrl = url.replace(apiKey, 'HIDDEN_API_KEY');
    this.logger.log(`[2Factor.in OTP] Initiating SMS OTP Request: ${maskedUrl}`);

    try {
      this.logger.log(
        `[2Factor.in OTP] Sending SMS OTP to destination with purpose: ${purpose}`,
      );

      const response = await fetch(url, {
        method: 'GET',
      });

      const resData = (await response.json()) as {
        Status?: string;
        Details?: string;
      };

      this.logger.log(`[2Factor.in OTP] Raw Response: ${JSON.stringify(resData)}`);

      const isSuccess =
        response.ok &&
        resData.Status &&
        resData.Status.toLowerCase() === 'success';

      if (!isSuccess) {
        this.logger.error(
          `[2FACTOR_SEND_FAILED] 2Factor Send OTP failed. Response: ${JSON.stringify(resData)}`,
        );
        throw new BadRequestException(
          resData.Details || 'Failed to send OTP via 2Factor. Check mobile number.',
        );
      }

      this.logger.log(
        `[2Factor.in OTP] OTP SMS sent successfully via 2Factor.in (Session ID: ${resData.Details}).`,
      );

      return {
        sessionId: resData.Details,
        providerManaged: true,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `[2FACTOR_SEND_FAILED] Connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'OTP service unavailable. Please try again.',
      );
    }
  }

  /**
   * Verifies OTP code via 2Factor.in API
   * GET https://2factor.in/API/V1/{api_key}/SMS/VERIFY/{session_id}/{otp_entered}
   * Fallback: GET https://2factor.in/API/V1/{api_key}/SMS/VERIFY3/{phone_number}/{otp_entered}
   */
  async verifyOtp(
    targetMobileOrSession: string,
    otp: string,
    purpose: OtpPurpose,
    sessionData?: TwoFactorSessionData,
  ): Promise<boolean> {
    const apiKey = this.getApiKey();
    const cleanOtp = otp.trim();

    let url: string;
    if (sessionData?.sessionId) {
      url = `${this.baseUrl}/${apiKey}/SMS/VERIFY/${sessionData.sessionId}/${cleanOtp}`;
    } else {
      const formattedMobile = this.formatMobileFor2Factor(targetMobileOrSession);
      url = `${this.baseUrl}/${apiKey}/SMS/VERIFY3/${formattedMobile}/${cleanOtp}`;
    }

    const maskedUrl = url.replace(apiKey, 'HIDDEN_API_KEY');
    this.logger.log(`[2Factor.in OTP] Initiating Verification Request: ${maskedUrl}`);

    try {
      this.logger.log(
        `[2Factor.in OTP] Verifying OTP with 2Factor for purpose: ${purpose}`,
      );

      const response = await fetch(url, {
        method: 'GET',
      });

      const resData = (await response.json()) as {
        Status?: string;
        Details?: string;
      };

      const isSuccess =
        response.ok &&
        resData.Status &&
        resData.Status.toLowerCase() === 'success' &&
        resData.Details &&
        resData.Details.toLowerCase().includes('match');

      if (isSuccess) {
        this.logger.log(`[2Factor.in OTP] Verification succeeded.`);
        return true;
      }

      this.logger.warn(
        `[2FACTOR_VERIFY_FAILED] Verification rejected. Status: ${resData.Status}, Details: ${resData.Details}`,
      );
      return false;
    } catch (err) {
      this.logger.error(
        `[2FACTOR_VERIFY_FAILED] 2Factor Verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'OTP service unavailable. Please try again.',
      );
    }
  }

  /**
   * Retries / Resends OTP explicitly via 2Factor.in SMS API
   */
  async retryOtp(
    mobileNumber: string,
    _retryType: 'text' | 'voice' = 'text',
  ): Promise<boolean> {
    const apiKey = this.getApiKey();
    const formattedMobile = this.formatMobileFor2Factor(mobileNumber);
    // Explicitly call SMS AUTOGEN endpoint to prevent voice calls
    const templateName = this.config.twoFactorTemplateName ? this.config.twoFactorTemplateName.trim() : '';
    const url = templateName
      ? `${this.baseUrl}/${apiKey}/SMS/${formattedMobile}/AUTOGEN/${templateName}`
      : `${this.baseUrl}/${apiKey}/SMS/${formattedMobile}/AUTOGEN`;

    const maskedUrl = url.replace(apiKey, 'HIDDEN_API_KEY');
    this.logger.log(`[2Factor.in OTP] Initiating Retry SMS Request: ${maskedUrl}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
      });

      const resData = (await response.json()) as {
        Status?: string;
        Details?: string;
      };

      return (
        response.ok &&
        Boolean(resData.Status && resData.Status.toLowerCase() === 'success')
      );
    } catch (err) {
      this.logger.warn(
        `[2FACTOR_RETRY_FAILED] Retry failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
