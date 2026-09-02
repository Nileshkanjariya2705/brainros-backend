import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Safely parses a string/boolean environment variable into a strict boolean.
 *
 * Prevents the common bug where `Boolean("false") === true`.
 * Valid true representations: 'true', '1', true
 * Valid false representations: 'false', '0', false, undefined, null, ''
 *
 * @throws Error if an invalid non-boolean value is supplied.
 */
export function parseSafeBoolean(
  value: string | boolean | undefined | null,
  varName = 'ENABLE_2FA',
  defaultValue = false,
): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  throw new Error(
    `Invalid boolean value for environment variable ${varName}: "${value}". Expected "true", "false", "1", or "0".`,
  );
}

@Injectable()
export class TwoFactorConfig {
  private readonly logger = new Logger(TwoFactorConfig.name);

  readonly enable2FA: boolean;
  readonly devBypassOtp: string;
  readonly otpTtl: number;
  readonly resendCooldown: number;
  readonly maxAttempts: number;
  readonly otpLength: number;
  readonly maxRequestsPerHour: number;

  constructor(private readonly configService: ConfigService) {
    const rawEnable2FA =
      this.configService.get<string | boolean>('ENABLE_2FA') ??
      process.env.ENABLE_2FA;

    this.enable2FA = parseSafeBoolean(rawEnable2FA, 'ENABLE_2FA', false);

    // Development bypass OTP code (default: 12345)
    // Only used when enable2FA === false. Strictly ignored when enable2FA === true.
    this.devBypassOtp =
      this.configService.get<string>('DEV_BYPASS_OTP') ||
      process.env.DEV_BYPASS_OTP ||
      '12345';

    this.otpTtl =
      Number(
        this.configService.get('OTP_TTL_SECONDS') ||
          process.env.OTP_TTL_SECONDS,
      ) || 300;

    this.resendCooldown =
      Number(
        this.configService.get('OTP_RESEND_COOLDOWN_SECONDS') ||
          process.env.OTP_RESEND_COOLDOWN_SECONDS,
      ) || 60;

    this.maxAttempts =
      Number(
        this.configService.get('OTP_MAX_VERIFY_ATTEMPTS') ||
          process.env.OTP_MAX_VERIFY_ATTEMPTS,
      ) || 5;

    this.otpLength =
      Number(
        this.configService.get('OTP_LENGTH') || process.env.OTP_LENGTH,
      ) || 5;

    this.maxRequestsPerHour =
      Number(
        this.configService.get('OTP_MAX_REQUESTS_PER_HOUR') ||
          process.env.OTP_MAX_REQUESTS_PER_HOUR,
      ) || 5;

    this.logger.log(
      `TwoFactorConfig initialized: [ENABLE_2FA = ${this.enable2FA ? 'TRUE (Real Provider)' : 'FALSE (Development Bypass)'}]`,
    );
  }
}
