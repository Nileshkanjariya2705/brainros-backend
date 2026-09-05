import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TwoFactorProvider {
  private readonly logger = new Logger(TwoFactorProvider.name);
  private readonly baseUrl = 'https://control.msg91.com/api/v5/otp';

  constructor(private readonly configService: ConfigService) {}

  private getAuthKey(): string {
    const authKey =
      this.configService.get<string>('MSG91_AUTH_KEY') ||
      this.configService.get<string>('OTP_API_KEY') ||
      process.env.MSG91_AUTH_KEY ||
      '567446A9gJtDpx6a9a2e53P1';

    if (!authKey) {
      this.logger.error('MSG91 credentials missing.');
      throw new InternalServerErrorException('MSG91 provider configuration error.');
    }
    return authKey.trim();
  }

  private formatMobile(mobileNumber: string): string {
    const digits = mobileNumber.replace(/\D/g, '');
    if (digits.length === 10) {
      return `91${digits}`;
    }
    return digits;
  }

  /**
   * Triggers SMS OTP verification via MSG91 OTP API
   */
  async sendOtp(mobileNumber: string): Promise<string> {
    const isRealEnabled =
      String(this.configService.get('ENABLE_REAL_OTP') ?? process.env.ENABLE_REAL_OTP).toLowerCase() === 'true' ||
      String(this.configService.get('ENABLE_2FA') ?? process.env.ENABLE_2FA).toLowerCase() === 'true';

    const formattedMobile = this.formatMobile(mobileNumber);

    if (!isRealEnabled) {
      this.logger.log(`[Development Bypass] Skipped MSG91 sendOtp for ${formattedMobile}`);
      return formattedMobile;
    }

    const authKey = this.getAuthKey();

    const queryParams = new URLSearchParams({
      mobile: formattedMobile,
      otp_length: '5',
      otp_expiry: '5',
      realTimeResponse: '1',
    });

    const templateId =
      this.configService.get<string>('MSG91_TEMPLATE_ID') ||
      process.env.MSG91_TEMPLATE_ID ||
      '6a9a366caea18f1a81002b07';
    if (templateId) {
      queryParams.set('template_id', templateId);
    }

    try {
      const response = await fetch(`${this.baseUrl}?${queryParams.toString()}`, {
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(8000),
      });

      const resData = (await response.json()) as {
        type?: string;
        message?: string;
      };

      const isSuccess =
        response.ok &&
        (resData.type === 'success' ||
          (resData.message && resData.message.toLowerCase().includes('success')));

      if (!isSuccess) {
        this.logger.error(`MSG91 Send OTP failed: ${JSON.stringify(resData)}`);
        throw new BadRequestException(
          resData.message || 'Failed to send OTP via MSG91.',
        );
      }

      return formattedMobile;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `MSG91 connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'SMS gateway is temporarily unavailable.',
      );
    }
  }

  /**
   * Verifies the user-entered OTP code via MSG91 Verify API
   */
  async verifyOtp(
    targetMobileOrSession: string,
    otp: string,
  ): Promise<boolean> {
    const isRealEnabled =
      String(this.configService.get('ENABLE_REAL_OTP') ?? process.env.ENABLE_REAL_OTP).toLowerCase() === 'true' ||
      String(this.configService.get('ENABLE_2FA') ?? process.env.ENABLE_2FA).toLowerCase() === 'true';

    const cleanOtp = (otp || '').trim();
    const bypassOtp = (this.configService.get('DEV_BYPASS_OTP') ?? process.env.DEV_BYPASS_OTP ?? '12345').trim();

    if (!isRealEnabled && (cleanOtp === bypassOtp || cleanOtp === '12345')) {
      this.logger.log(`[Development Bypass] OTP ${otp} accepted for ${targetMobileOrSession}`);
      return true;
    }

    const authKey = this.getAuthKey();
    const formattedMobile = this.formatMobile(targetMobileOrSession);

    const queryParams = new URLSearchParams({
      mobile: formattedMobile,
      otp: otp.trim(),
    });

    try {
      const response = await fetch(
        `${this.baseUrl}/verify?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: {
            authkey: authKey,
          },
          signal: AbortSignal.timeout(8000),
        },
      );

      const resData = (await response.json()) as {
        type?: string;
        message?: string;
      };

      return Boolean(
        response.ok &&
        (resData.type === 'success' ||
          (resData.message &&
            (resData.message.toLowerCase().includes('success') ||
              resData.message.toLowerCase().includes('verified')))),
      );
    } catch (err) {
      this.logger.error(
        `MSG91 Verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'Verification gateway is temporarily unavailable.',
      );
    }
  }
}
