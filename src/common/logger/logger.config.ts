export const SENSITIVE_KEYS = [
  'password',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'jwt',
  'secret',
  'otp',
  'otpcode',
  'dev_bypass_otp',
  'dev_otp_code',
  'apikey',
  'api_key',
  'email_api_key',
  'two_factor_api_key',
  'msg91_auth_key',
  's3_access_key',
  's3_secret_key',
  'database_url',
  'direct_url',
  'redis_url',
  'redis_password',
  'authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
];

export const SENSITIVE_PATH_PATTERNS = [
  /\/auth\/login/i,
  /\/auth\/register/i,
  /\/auth\/verify-otp/i,
  /\/auth\/refresh/i,
  /\/auth\/password/i,
  /\/auth\/change-mobile/i,
  /\/auth\/change-email/i,
];

export function getLogLevel(): string {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(envLevel)) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export function getSlowRequestThreshold(): number {
  const threshold = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS || '1000', 10);
  return isNaN(threshold) ? 1000 : threshold;
}

export function shouldLogRequestBody(): boolean {
  return process.env.ENABLE_HTTP_BODY_LOGGING === 'true';
}

/**
 * Deep-redacts sensitive fields in any object or nested structure.
 */
export function redactSensitiveData(data: any, depth = 0): any {
  if (depth > 5 || data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact Bearer tokens if found in strings
    if (data.toLowerCase().startsWith('bearer ')) {
      return 'Bearer [REDACTED]';
    }
    // Redact passwords inside URLs like postgresql://user:pass@host/db
    if (data.includes('://') && data.includes('@')) {
      return data.replace(/:([^:@]+)@/, ':****@');
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const redacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s.replace(/[-_]/g, '')))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value, depth + 1);
      }
    }
    return redacted;
  }

  return data;
}
