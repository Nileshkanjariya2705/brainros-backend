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
  readonly otpProvider: '2FACTOR' | 'MSG91';
  readonly twoFactorApiKey: string;
  readonly devBypassOtp: string;
  readonly msg91AuthKey: string;
  readonly msg91TemplateId: string;
  readonly otpTtl: number;
  readonly resendCooldown: number;
  readonly maxAttempts: number;
  readonly otpLength: number;
  readonly maxRequestsPerHour: number;

  constructor(private readonly configService: ConfigService) {
    const rawEnable =
      this.configService.get<string | boolean>('ENABLE_REAL_OTP') ??
      this.configService.get<string | boolean>('ENABLE_2FA') ??
      this.configService.get<string | boolean>('ENABLE_OTP') ??
      process.env.ENABLE_REAL_OTP ??
      process.env.ENABLE_2FA ??
      process.env.ENABLE_OTP;

    this.enable2FA = parseSafeBoolean(rawEnable, 'ENABLE_REAL_OTP', false);

    // OTP Gateway provider selector: "2FACTOR" | "MSG91"
    const rawProvider = (
      this.configService.get<string>('OTP_PROVIDER') ??
      process.env.OTP_PROVIDER ??
      '2FACTOR'
    ).trim().toUpperCase();

    this.otpProvider = rawProvider === 'MSG91' ? 'MSG91' : '2FACTOR';

    // 2Factor.in API Key
    this.twoFactorApiKey =
      this.configService.get<string>('TWO_FACTOR_API_KEY') ??
      this.configService.get<string>('TWOFACTOR_API_KEY') ??
      process.env.TWO_FACTOR_API_KEY ??
      process.env.TWOFACTOR_API_KEY ??
      '749e2f32-9fd7-11f1-9cb1-0200cd936042';

    // Development bypass OTP code (default: 12345)
    // Only used when enable2FA === false. Strictly ignored when enable2FA === true.
    this.devBypassOtp =
      this.configService.get<string>('DEV_BYPASS_OTP') ??
      this.configService.get<string>('DEV_OTP_CODE') ??
      process.env.DEV_BYPASS_OTP ??
      process.env.DEV_OTP_CODE ??
      '12345';

    // MSG91 API configuration
    this.msg91AuthKey =
      this.configService.get<string>('MSG91_AUTH_KEY') ??
      this.configService.get<string>('OTP_API_KEY') ??
      process.env.MSG91_AUTH_KEY ??
      process.env.OTP_API_KEY ??
      '567446TwYGGZ8O6a9ab826P1';

    this.msg91TemplateId =
      this.configService.get<string>('MSG91_TEMPLATE_ID') ??
      process.env.MSG91_TEMPLATE_ID ??
      '6a9a366caea18f1a81002b07';

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
      `TwoFactorConfig initialized: [ENABLE_REAL_OTP = ${this.enable2FA ? 'TRUE (Active Gateway: ' + this.otpProvider + ')' : 'FALSE (Development Bypass: ' + this.devBypassOtp + ')'}]`,
    );
  }
}
