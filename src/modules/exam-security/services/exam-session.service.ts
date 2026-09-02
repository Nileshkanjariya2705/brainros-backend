import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ExamSessionStatus } from '@prisma/client';
import { HeartbeatDto } from '../dto/security.dto';

@Injectable()
export class ExamSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Create or resume an active exam session for an attempt
   */
  async createOrResumeSession(
    attemptId: string,
    userId: string,
    deviceMetadata?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
    transferSession?: boolean,
    sessionId?: string,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        securityProfile: true,
        student: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempt.student?.userId !== userId && attempt.studentId !== userId) {
      throw new ForbiddenException('You do not own this attempt');
    }

    const now = new Date();

    // ── Check for existing active session conflict in Redis ─────────
    try {
      const existingSessionId = await this.redisService.get(
        `exam:attempt:${attemptId}:session`,
      );
      const lastHb = await this.redisService.get(
        `exam:attempt:${attemptId}:heartbeat`,
      );
      const isRecentlyActive =
        lastHb && now.getTime() - new Date(lastHb).getTime() < 45000;

      // If it's the exact same session resuming / refreshing, keep it active without conflict
      if (sessionId && existingSessionId && sessionId === existingSessionId) {
        await this.redisService.set(
          `exam:attempt:${attemptId}:heartbeat`,
          now.toISOString(),
          86400,
        );
        return {
          id: existingSessionId,
          status: 'ACTIVE',
          conflict: false,
        };
      }

      // If active in another window/device and transferSession is NOT requested, report conflict
      if (existingSessionId && isRecentlyActive && !transferSession) {
        return {
          id: existingSessionId,
          status: 'CONFLICT',
          conflict: true,
          message:
            'This exam attempt is already actively open in another browser tab or device.',
        };
      }
    } catch {
      // Non-blocking Redis check fallback
    }

    // Invalidate existing active sessions in database
    await this.prisma.examSession.updateMany({
      where: {
        attemptId,
        status: ExamSessionStatus.ACTIVE,
      },
      data: {
        status: ExamSessionStatus.INVALIDATED,
      },
    });

    const session = await this.prisma.examSession.create({
      data: {
        attemptId,
        userId,
        deviceMetadata: deviceMetadata || {},
        userAgent,
        ipAddress,
        startedAt: now,
        lastHeartbeatAt: now,
        status: ExamSessionStatus.ACTIVE,
      },
    });

    // Cache active session in Redis with 24hr TTL
    try {
      await this.redisService.set(
        `exam:attempt:${attemptId}:session`,
        session.id,
        86400,
      );
      await this.redisService.set(
        `exam:attempt:${attemptId}:heartbeat`,
        now.toISOString(),
        86400,
      );
    } catch {
      // Non-blocking Redis fallback
    }

    return {
      id: session.id,
      status: ExamSessionStatus.ACTIVE,
      conflict: false,
    };
  }

  /**
   * Record periodic heartbeat from client
   */
  async recordHeartbeat(
    attemptId: string,
    dto: HeartbeatDto,
    userId: string,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        status: true,
        student: true,
        securityProfile: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempt.student?.userId !== userId && attempt.studentId !== userId) {
      throw new ForbiddenException('You do not own this attempt');
    }

    const now = new Date();

    // Check if attempt is expired according to serverEndTime
    const isExpired =
      attempt.serverEndTime && now.getTime() > attempt.serverEndTime.getTime();

    // Check for active session ID consistency
    let multipleSessionDetected = false;
    if (dto.sessionId) {
      try {
        const cachedActiveSessionId = await this.redisService.get(
          `exam:attempt:${attemptId}:session`,
        );
        if (cachedActiveSessionId && cachedActiveSessionId !== dto.sessionId) {
          multipleSessionDetected = true;
        }
      } catch {
        // Fallback
      }

      // Update session lastHeartbeatAt
      await this.prisma.examSession.update({
        where: { id: dto.sessionId },
        data: { lastHeartbeatAt: now },
      }).catch(() => {});
    }

    // Refresh Redis heartbeat and session TTL
    try {
      await this.redisService.set(
        `exam:attempt:${attemptId}:heartbeat`,
        now.toISOString(),
        86400,
      );
      if (dto.sessionId && !multipleSessionDetected) {
        await this.redisService.set(
          `exam:attempt:${attemptId}:session`,
          dto.sessionId,
          86400,
        );
      }
    } catch {
      // Non-blocking Redis fallback
    }

    return {
      attemptId,
      serverTime: now.toISOString(),
      isExpired,
      attemptStatus: attempt.status.name,
      isFlagged: attempt.isFlagged,
      disqualifiedAt: attempt.disqualifiedAt,
      multipleSessionDetected,
      heartbeatIntervalSeconds:
        attempt.securityProfile?.heartbeatIntervalSeconds || 30,
    };
  }
}
