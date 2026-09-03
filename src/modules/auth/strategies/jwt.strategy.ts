import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

import { ACCESS_COOKIE_NAME } from '../utils/cookie.util';

const cookieExtractor = (req: Request): string | null => {
  if (req && req.cookies) {
    const cookies = req.cookies as Record<string, string | undefined>;
    return (
      cookies[ACCESS_COOKIE_NAME] ||
      cookies['access_token'] ||
      cookies['accessToken'] ||
      null
    );
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
        ExtractJwt.fromUrlQueryParameter('accessToken'),
      ]),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        configService.get<string>('JWT_ACCESS_SECRET') ||
        'super-secret-jwt-key-replace-in-production',
    });
  }

  async validate(payload: { sub: string; sessionId: string; type: string }) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type.');
    }

    // Load user with roles
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: { role: true },
        },
        student: { select: { id: true, studentId: true, studentCode: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists.');
    }

    // Verify user status
    if (user.status !== 'ACTIVE' && user.status !== 'PENDING') {
      throw new UnauthorizedException(
        `User account is ${user.status.toLowerCase()}.`,
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive.');
    }

    // Verify session is still valid (if sessionId is provided)
    if (payload.sessionId) {
      const session = await this.prisma.loginSession.findUnique({
        where: { id: payload.sessionId },
      });

      if (session) {
        if (session.revokedAt) {
          throw new UnauthorizedException('Session has been revoked.');
        }
        if (new Date() > session.expiresAt) {
          throw new UnauthorizedException('Session has expired.');
        }
      }
      // If session not found, allow (backward compatibility with tokens issued before session system)
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    return {
      userId: payload.sub,
      sessionId: payload.sessionId,
      roles,
      studentId: user.student?.id ?? null,
      studentPublicId: user.student?.studentId ?? null,
      studentCode: user.student?.studentCode ?? null,
    };
  }
}
