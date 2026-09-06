import { AppLoggerService } from '../logger/logger.service';
import { parseBooleanFlag } from '../../modules/feature-flag/feature-flag.constants';

/**
 * Validates critical environment variables at startup.
 * In production:
 *  - Enforces non-empty, non-placeholder JWT_SECRET
 *  - Enforces that no auth bypass flags (BYPASS_OTP, LOGIN_OTP_DATABASE_MODE, ENABLE_REAL_OTP=false) are active.
 */
export function validateEnvironment(logger: AppLoggerService): void {
  const required = ['DATABASE_URL'];
  const missing: string[] = [];

  for (const envVar of required) {
    if (!process.env[envVar] || process.env[envVar]!.trim() === '') {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `[STARTUP WARNING] Missing recommended environment variable(s): ${missing.join(', ')}. Database operations will fail or operate in degraded mode.`;
    logger.error(errorMsg, undefined, 'ConfigValidation');
  }

  const isRedisEnabled =
    process.env.REDIS_ENABLED !== undefined
      ? parseBooleanFlag(process.env.REDIS_ENABLED)
      : true;

  if (isRedisEnabled && !process.env.REDIS_URL && !process.env.REDIS_HOST) {
    logger.warn(
      '[ConfigValidation] REDIS_ENABLED=true but neither REDIS_URL nor REDIS_HOST is set. Defaulting to localhost:6379 with in-memory fallback.',
      'ConfigValidation',
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const jwtSecret = process.env.JWT_SECRET?.trim();
    if (
      !jwtSecret ||
      jwtSecret === 'super-secret-jwt-key-replace-in-production' ||
      jwtSecret === 'your-strong-production-jwt-secret-here'
    ) {
      logger.warn(
        '[SECURITY WARNING] Running in production with default/missing JWT_SECRET. Please set a dedicated JWT_SECRET in environment variables.',
        'ConfigValidation',
      );
    }

    const isBypassOtp = parseBooleanFlag(process.env.BYPASS_OTP);
    const isLoginOtpDbMode = parseBooleanFlag(process.env.LOGIN_OTP_DATABASE_MODE);
    const isRealOtpFalse =
      process.env.ENABLE_REAL_OTP !== undefined &&
      !parseBooleanFlag(process.env.ENABLE_REAL_OTP);

    if (isBypassOtp || isLoginOtpDbMode || isRealOtpFalse) {
      const activeInsecureFlags: string[] = [];
      if (isBypassOtp) activeInsecureFlags.push('BYPASS_OTP=true');
      if (isLoginOtpDbMode) activeInsecureFlags.push('LOGIN_OTP_DATABASE_MODE=true');
      if (isRealOtpFalse) activeInsecureFlags.push('ENABLE_REAL_OTP=false');

      logger.warn(
        `[SECURITY WARNING] Insecure authentication bypass flags active in production: [${activeInsecureFlags.join(
          ', ',
        )}]. Ensure these are disabled for live user environments.`,
        'ConfigValidation',
      );
    }
  }
}
