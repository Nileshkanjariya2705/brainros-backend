import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TwoFactorProvider {
  private readonly logger = new Logger(TwoFactorProvider.name);
  private readonly baseUrl = 'https://verify.twilio.com/v2';
  private cachedServiceSid: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getAuthHeader(): string {
    const sid =
      this.configService.get<string>('TWILIO_API_KEY_SID') ||
      this.configService.get<string>('TWILIO_ACCOUNT_SID') ||
      this.configService.get<string>('TWO_FACTOR_API_KEY');

    const secret =
      this.configService.get<string>('TWILIO_API_KEY_SECRET') ||
      this.configService.get<string>('TWILIO_AUTH_TOKEN');

    if (!sid || !secret) {
      this.logger.error('Twilio credentials (TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET) are missing.');
      throw new InternalServerErrorException('Twilio provider configuration error.');
    }
    const token = Buffer.from(`${sid}:${secret}`).toString('base64');
    return `Basic ${token}`;
  }

  /**
   * Retrieves or auto-creates a Twilio Verify Service SID
   */
  private async getOrCreateServiceSid(): Promise<string> {
    if (this.cachedServiceSid) return this.cachedServiceSid;

    const envServiceSid = this.configService.get<string>('TWILIO_VERIFY_SERVICE_SID');
    if (envServiceSid) {
      this.cachedServiceSid = envServiceSid;
      return envServiceSid;
    }

    const authHeader = this.getAuthHeader();

    // 1. Try listing existing Twilio Verify services
    try {
      const listResponse = await fetch(`${this.baseUrl}/Services`, {
        headers: { Authorization: authHeader },
      });
      const listData = (await listResponse.json()) as { services?: { sid: string; friendly_name: string }[] };

      if (listResponse.ok && listData.services && listData.services.length > 0) {
        this.cachedServiceSid = listData.services[0].sid;
        this.logger.log(`Using existing Twilio Verify Service SID: ${this.cachedServiceSid}`);
        return this.cachedServiceSid;
      }
    } catch (err) {
      this.logger.warn(`Failed to list Twilio Verify services: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Auto-create a new Twilio Verify service if none exists
    try {
      const createResponse = await fetch(`${this.baseUrl}/Services`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ FriendlyName: 'Exam Management System' }).toString(),
      });

      const createData = (await createResponse.json()) as { sid?: string; message?: string };
      if (createResponse.ok && createData.sid) {
        this.cachedServiceSid = createData.sid;
        this.logger.log(`Created new Twilio Verify Service SID: ${this.cachedServiceSid}`);
        return this.cachedServiceSid;
      }
      throw new Error(createData.message || 'Failed to create Twilio Verify service');
    } catch (err) {
      this.logger.error(`Error configuring Twilio Verify Service: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('Failed to initialize Twilio Verify Service.');
    }
  }

  /**
   * Triggers SMS OTP verification via Twilio Verify API
   * POST https://verify.twilio.com/v2/Services/{ServiceSid}/Verifications
   */
  async sendOtp(mobileNumber: string): Promise<string> {
    const serviceSid = await this.getOrCreateServiceSid();
    const authHeader = this.getAuthHeader();

    const body = new URLSearchParams({
      To: mobileNumber,
      Channel: 'sms',
    }).toString();

    try {
      const response = await fetch(`${this.baseUrl}/Services/${serviceSid}/Verifications`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const resData = (await response.json()) as { sid?: string; status?: string; message?: string };

      if (!response.ok || (resData.status !== 'pending' && !resData.sid)) {
        this.logger.error(`Twilio Send OTP failed for ${mobileNumber}. Message: ${resData.message || resData.status}`);
        throw new BadRequestException(resData.message || 'Failed to send OTP via Twilio. Check mobile number.');
      }

      this.logger.log(`Twilio OTP SMS sent successfully to ${mobileNumber}.`);
      // Return the mobile number so verifyOtp can pass it as the target recipient
      return mobileNumber;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Twilio connection error: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('SMS gateway is temporarily unavailable.');
    }
  }

  /**
   * Verifies the user-entered OTP code via Twilio Verify API
   * POST https://verify.twilio.com/v2/Services/{ServiceSid}/VerificationCheck
   */
  async verifyOtp(targetMobileOrSession: string, otp: string): Promise<boolean> {
    const serviceSid = await this.getOrCreateServiceSid();
    const authHeader = this.getAuthHeader();

    const body = new URLSearchParams({
      To: targetMobileOrSession,
      Code: otp,
    }).toString();

    try {
      const response = await fetch(`${this.baseUrl}/Services/${serviceSid}/VerificationCheck`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const resData = (await response.json()) as { status?: string; valid?: boolean; message?: string };

      if (response.ok && (resData.status === 'approved' || resData.valid === true)) {
        return true;
      }

      this.logger.warn(`Twilio verification failed for ${targetMobileOrSession}. Status: ${resData.status}, Message: ${resData.message}`);
      return false;
    } catch (err) {
      this.logger.error(`Twilio VerificationCheck error: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('Verification gateway is temporarily unavailable.');
    }
  }
}
