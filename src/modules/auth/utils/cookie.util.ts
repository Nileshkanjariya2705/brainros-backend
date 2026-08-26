import { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';

export const REFRESH_COOKIE_NAME = 'refreshToken';

export function getRefreshCookieOptions(configService: ConfigService): CookieOptions {
  const isProd = configService.get<string>('NODE_ENV') === 'production';
  const sameSiteConfig = configService.get<string>('COOKIE_SAME_SITE');
  const sameSite: 'lax' | 'strict' | 'none' = (sameSiteConfig as any) || (isProd ? 'none' : 'lax');
  const secure = configService.get<string>('COOKIE_SECURE') === 'true' || (isProd && sameSite === 'none');
  const domain = configService.get<string>('COOKIE_DOMAIN') || undefined;
  const refreshExpiryDays = 7;

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',
    maxAge: refreshExpiryDays * 24 * 60 * 60 * 1000,
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
