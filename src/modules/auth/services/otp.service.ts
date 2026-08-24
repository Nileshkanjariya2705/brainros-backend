import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { TwoFactorProvider } from '../otp/two-factor.provider';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly twoFactorProvider: TwoFactorProvider,
  ) {}

  /**
   * Normalizes mobile numbers to E.164 format (starts with +)
   */
  normalizeMobileNumber(mobileNumber: string): string {
    const clean = mobileNumber.replace(/[^\d+]/g, '');

    // Standard Indian number rules
    if (clean.startsWith('+91') && clean.length === 13) {
      return clean;
    }
    if (clean.startsWith('91') && clean.length === 12) {
      return `+${clean}`;
    }
    if (clean.length === 10) {
      return `+91${clean}`;
    }
    if (!clean.startsWith('+')) {
      return `+${clean}`;
    }
    return clean;
  }

  /**
   * Triggers OTP sending via 2Factor, checking resend cooldown in Redis
   */
  async sendOtp(rawMobileNumber: string): Promise<void> {
    const mobileNumber = this.normalizeMobileNumber(rawMobileNumber);

    const ttl = Number(this.configService.get('OTP_TTL_SECONDS')) || 300;
    const cooldown = Number(this.configService.get('OTP_RESEND_COOLDOWN_SECONDS')) || 60;

    const cooldownKey = `otp:cooldown:${mobileNumber}`;
    const sessionKey = `otp:session:${mobileNumber}`;
    const attemptsKey = `otp:attempts:${mobileNumber}`;

    // 1. Check Resend Cooldown
    const isCooldownActive = await this.redisService.get(cooldownKey);
    if (isCooldownActive) {
      throw new BadRequestException(`Please wait ${cooldown} seconds before requesting another OTP.`);
    }

    // 2. Call 2Factor API to send OTP and get Session ID
    const devOtpCode = this.configService.get<string>('DEV_OTP_CODE');
    const isTestEnv = this.configService.get<string>('NODE_ENV') === 'test' || process.env.NODE_ENV === 'test';
    let sessionId: string;
    if (devOtpCode && !isTestEnv) {
      sessionId = 'dev-session-id';
      this.logger.log(`[DEV BYPASS] Sending OTP to ${mobileNumber} bypassed. Use code: ${devOtpCode}`);
    } else {
      sessionId = await this.twoFactorProvider.sendOtp(mobileNumber);
    }

    // 3. Persist Session ID in Redis
    await this.redisService.set(sessionKey, JSON.stringify({ sessionId }), ttl);

    // 4. Set Cooldown flag in Redis
    await this.redisService.set(cooldownKey, '1', cooldown);

    // 5. Reset attempts count
    await this.redisService.del(attemptsKey);

    this.logger.log(`OTP successfully requested and sent to ${mobileNumber}.`);
  }

  /**
   * Verifies the user-entered OTP using 2Factor and checks attempts limit in Redis
   */
  async verifyOtp(rawMobileNumber: string, otp: string): Promise<boolean> {
    const mobileNumber = this.normalizeMobileNumber(rawMobileNumber);

    const ttl = Number(this.configService.get('OTP_TTL_SECONDS')) || 300;
    const maxAttempts = Number(this.configService.get('OTP_MAX_VERIFY_ATTEMPTS')) || 5;

    const sessionKey = `otp:session:${mobileNumber}`;
    const attemptsKey = `otp:attempts:${mobileNumber}`;

    // 1. Check failed attempts limit
    const attemptsStr = await this.redisService.get(attemptsKey);
    const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;
    if (attempts >= maxAttempts) {
      // Invalidate the session
      await this.redisService.del(sessionKey);
      await this.redisService.del(attemptsKey);
      throw new BadRequestException('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    // 2. Retrieve session info
    const sessionDataStr = await this.redisService.get(sessionKey);
    if (!sessionDataStr) {
      throw new BadRequestException('OTP has expired or has not been requested.');
    }

    const { sessionId } = JSON.parse(sessionDataStr) as { sessionId: string };

    // 3. Verify OTP with 2Factor (or bypass in dev mode)
    const devOtpCode = this.configService.get<string>('DEV_OTP_CODE');
    const isTestEnv = this.configService.get<string>('NODE_ENV') === 'test' || process.env.NODE_ENV === 'test';
    let isValid = false;
    if (devOtpCode && !isTestEnv) {
      isValid = (otp === devOtpCode);
    } else {
      isValid = await this.twoFactorProvider.verifyOtp(sessionId, otp);
    }

    if (!isValid) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= maxAttempts) {
        // Invalidate session immediately
        await this.redisService.del(sessionKey);
        await this.redisService.del(attemptsKey);
        throw new BadRequestException('Maximum verification attempts exceeded. Please request a new OTP.');
      } else {
        // Increment attempts count
        await this.redisService.set(attemptsKey, String(nextAttempts), ttl);
        throw new BadRequestException(`Invalid OTP. Remaining attempts: ${maxAttempts - nextAttempts}.`);
      }
    }

    // 4. Verification succeeded, clear Redis states
    await this.redisService.del(sessionKey);
    await this.redisService.del(attemptsKey);

    return true;
  }
}
