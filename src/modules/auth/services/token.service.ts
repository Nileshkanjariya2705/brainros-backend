import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventService } from './security-event.service';
import * as crypto from 'crypto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId?: string;
  sessionId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  sessionId: string;
  type: 'access';
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly refreshExpiryDays: number;
  private readonly accessExpiresIn: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly securityEventService: SecurityEventService,
  ) {
    this.refreshExpiryDays = this.parseExpiryDays(
      this.configService.get('JWT_REFRESH_EXPIRATION') || '7d',
    );
    this.accessExpiresIn =
      this.configService.get('JWT_ACCESS_EXPIRATION') || '15m';
  }

  /**
   * Parse expiry string like '7d' or '30d' to number of days
   */
  private parseExpiryDays(expiry: string): number {
    const match = expiry.match(/^(\d+)d$/);
    return match ? parseInt(match[1], 10) : 7;
  }

  /**
   * Parse access token expiry to seconds for response
   */
  private getAccessExpirySeconds(): number {
    const match = this.accessExpiresIn.match(/^(\d+)(m|h|s)$/);
    if (!match) return 900; // default 15 min
    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      default:
        return 900;
    }
  }

  /**
   * Generates a random secure refresh token string
   */
  private generateRandomToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }

  /**
   * Hashes a token string using SHA-256
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates both Access Token (JWT) and Refresh Token (stored in DB)
   * linked to a specific login session.
   */
  async generateTokens(userId: string, sessionId: string): Promise<TokenPair> {
    // 1. Generate JWT Access Token with minimal claims
    const payload: AccessTokenPayload = {
      sub: userId,
      sessionId,
      type: 'access',
    };
    const accessToken = this.jwtService.sign(payload);

    // 2. Generate Refresh Token
    const rawRefreshToken = this.generateRandomToken();
    const tokenHash = this.hashToken(rawRefreshToken);

    // Set Refresh Token Expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshExpiryDays);

    // 3. Save Refresh Token Hash to Database
    await this.prisma.refreshToken.create({
      data: {
        userId,
        sessionId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.getAccessExpirySeconds(),
      userId,
      sessionId,
    };
  }

  /**
   * Rotates refresh token: revokes old, issues new pair.
   * Implements reuse detection.
   */
  async refreshAccessTokens(
    rawRefreshToken: string,
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawRefreshToken);

    // 1. Retrieve refresh token from database
    const dbToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
        session: true,
      },
    });

    if (!dbToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    // 2. REUSE DETECTION: If token was already revoked/rotated, it's being reused
    if (dbToken.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${dbToken.userId}, session ${dbToken.sessionId}`,
      );

      // Revoke the entire session (token family) for security
      if (dbToken.sessionId) {
        await this.prisma.$transaction([
          this.prisma.loginSession.update({
            where: { id: dbToken.sessionId },
            data: { revokedAt: new Date() },
          }),
          this.prisma.refreshToken.updateMany({
            where: { sessionId: dbToken.sessionId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]);
      }

      // Log security event
      await this.securityEventService.log('REFRESH_REUSE_DETECTED', {
        userId: dbToken.userId,
        ipAddress: requestContext?.ipAddress,
        userAgent: requestContext?.userAgent,
        metadata: { sessionId: dbToken.sessionId, tokenId: dbToken.id },
      });

      throw new UnauthorizedException(
        'Refresh token has been revoked. Please login again.',
      );
    }

    // 3. Check if token is expired
    if (new Date() > dbToken.expiresAt) {
      await this.prisma.refreshToken.update({
        where: { id: dbToken.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has expired.');
    }

    // 4. Verify session is still active
    if (dbToken.session && dbToken.session.revokedAt) {
      throw new UnauthorizedException(
        'Session has been revoked. Please login again.',
      );
    }

    if (dbToken.session && new Date() > dbToken.session.expiresAt) {
      throw new UnauthorizedException(
        'Session has expired. Please login again.',
      );
    }

    // 5. Check user status
    if (!dbToken.user.isActive || dbToken.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active.');
    }

    // 6. Generate new token pair
    const sessionId = dbToken.sessionId || dbToken.session?.id;
    const newRawRefreshToken = this.generateRandomToken();
    const newTokenHash = this.hashToken(newRawRefreshToken);

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + this.refreshExpiryDays);

    // 7. Atomic: verify unrevoked + create new token + link rotation
    const newToken = await this.prisma.$transaction(async (tx) => {
      // Atomically revoke old token. If count === 0, another concurrent request already rotated it.
      const updateResult = await tx.refreshToken.updateMany({
        where: { id: dbToken.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new UnauthorizedException(
          'Refresh token was already used or revoked.',
        );
      }

      // Create new refresh token
      const created = await tx.refreshToken.create({
        data: {
          userId: dbToken.userId,
          sessionId: sessionId || null,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
        },
      });

      // Link replacement ID for audit trail
      await tx.refreshToken.update({
        where: { id: dbToken.id },
        data: { replacedByTokenId: created.id },
      });

      // Update session activity
      if (sessionId) {
        await tx.loginSession
          .update({
            where: { id: sessionId },
            data: { lastActivityAt: new Date() },
          })
          .catch(() => {});
      }

      return created;
    });

    // 8. Generate new access token
    const payload: AccessTokenPayload = {
      sub: dbToken.userId,
      sessionId: sessionId || newToken.id,
      type: 'access',
    };
    const accessToken = this.jwtService.sign(payload);

    // Log token refresh event
    await this.securityEventService.log('TOKEN_REFRESHED', {
      userId: dbToken.userId,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
      metadata: { sessionId },
    });

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: this.getAccessExpirySeconds(),
      userId: dbToken.userId,
      sessionId,
    };
  }

  /**
   * Revokes a refresh token (used for logout)
   */
  async revokeRefreshToken(rawRefreshToken: string): Promise<string | null> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const dbToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (dbToken && !dbToken.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: dbToken.id },
        data: { revokedAt: new Date() },
      });
      return dbToken.sessionId;
    }

    return null;
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }
}
