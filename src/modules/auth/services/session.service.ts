import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessionExpiryDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.sessionExpiryDays = Number(this.configService.get('SESSION_EXPIRY_DAYS')) || 30;
  }

  /**
   * Create a new login session
   */
  async createSession(params: {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.sessionExpiryDays);

    return this.prisma.loginSession.create({
      data: {
        userId: params.userId,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent ? params.userAgent.substring(0, 500) : null,
        deviceId: params.deviceId || null,
        expiresAt,
        metadata: params.metadata ? (params.metadata as any) : null,
      },
    });
  }

  /**
   * Update last activity timestamp
   */
  async touchSession(sessionId: string): Promise<void> {
    await this.prisma.loginSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    }).catch(() => {
      // Non-critical, don't throw
    });
  }

  /**
   * Check if session is valid (not expired, not revoked)
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.prisma.loginSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return false;
    if (session.revokedAt) return false;
    if (new Date() > session.expiresAt) return false;

    return true;
  }

  /**
   * Revoke a specific session and all its refresh tokens
   */
  async revokeSession(sessionId: string): Promise<void> {
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.loginSession.update({
        where: { id: sessionId },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
    ]);
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string): Promise<void> {
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.loginSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
    ]);
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string) {
    return this.prisma.loginSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        deviceId: true,
        userAgent: true,
        ipAddress: true,
        lastActivityAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  /**
   * Revoke a specific session belonging to a user (authorization check)
   */
  async revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.prisma.loginSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) return false;

    await this.revokeSession(sessionId);
    return true;
  }
}
