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
    const singleSessionRequired =
      attempt.securityProfile?.singleSessionRequired ?? false;

    // Invalidate existing active sessions if single session required
    if (singleSessionRequired) {
      await this.prisma.examSession.updateMany({
        where: {
          attemptId,
          status: ExamSessionStatus.ACTIVE,
        },
        data: {
          status: ExamSessionStatus.INVALIDATED,
        },
      });
    }

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

    return session;
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

    // Refresh Redis heartbeat
    try {
      await this.redisService.set(
        `exam:attempt:${attemptId}:heartbeat`,
        now.toISOString(),
        86400,
      );
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
