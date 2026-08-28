import { Response, CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';

export const ACCESS_COOKIE_NAME = 'accessToken';
export const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Parse expiration string (e.g. '15m', '1h', '7d', '900s') into milliseconds.
 */
export function parseDurationToMs(durationStr?: string, defaultMs: number = 15 * 60 * 1000): number {
  if (!durationStr) return defaultMs;
  const match = durationStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return defaultMs;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return defaultMs;
  }
}

export function getAccessCookieOptions(configService: ConfigService): CookieOptions {
  const isProd = configService.get<string>('NODE_ENV') === 'production';
  const sameSiteConfig = configService.get<string>('COOKIE_SAME_SITE');
  const sameSite: 'lax' | 'strict' | 'none' = (sameSiteConfig as any) || (isProd ? 'none' : 'lax');
  const secure = configService.get<string>('COOKIE_SECURE') === 'true' || (isProd && sameSite === 'none');
  const domain = configService.get<string>('COOKIE_DOMAIN') || undefined;
  const accessExpiryMs = parseDurationToMs(
    configService.get<string>('JWT_ACCESS_EXPIRATION'),
    15 * 60 * 1000,
  );

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',
    maxAge: accessExpiryMs,
  };
}

export function getRefreshCookieOptions(configService: ConfigService): CookieOptions {
  const isProd = configService.get<string>('NODE_ENV') === 'production';
  const sameSiteConfig = configService.get<string>('COOKIE_SAME_SITE');
  const sameSite: 'lax' | 'strict' | 'none' = (sameSiteConfig as any) || (isProd ? 'none' : 'lax');
  const secure = configService.get<string>('COOKIE_SECURE') === 'true' || (isProd && sameSite === 'none');
  const domain = configService.get<string>('COOKIE_DOMAIN') || undefined;
  const refreshExpiryMs = parseDurationToMs(
    configService.get<string>('JWT_REFRESH_EXPIRATION'),
    7 * 24 * 60 * 60 * 1000,
  );

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',
    maxAge: refreshExpiryMs,
  };
}

export function getRefreshCookieClearOptions(configService: ConfigService): CookieOptions {
  const isProd = configService.get<string>('NODE_ENV') === 'production';
  const sameSiteConfig = configService.get<string>('COOKIE_SAME_SITE');
  const sameSite: 'lax' | 'strict' | 'none' = (sameSiteConfig as any) || (isProd ? 'none' : 'lax');
  const secure = configService.get<string>('COOKIE_SECURE') === 'true' || (isProd && sameSite === 'none');
  const domain = configService.get<string>('COOKIE_DOMAIN') || undefined;

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',
  };
}

/**
 * Sets both Access Token and Refresh Token as HTTP cookies on the response.
 */
export function setAuthCookies(
  res: Response,
  configService: ConfigService,
  tokens: { accessToken?: string; refreshToken?: string },
): void {
  if (tokens.accessToken) {
    res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, getAccessCookieOptions(configService));
  }
  if (tokens.refreshToken) {
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, getRefreshCookieOptions(configService));
  }
}

/**
 * Clears both Access Token and Refresh Token HTTP cookies on the response.
 */
export function clearAuthCookies(res: Response, configService: ConfigService): void {
  const clearOptions = getRefreshCookieClearOptions(configService);
  res.clearCookie(ACCESS_COOKIE_NAME, clearOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
}
