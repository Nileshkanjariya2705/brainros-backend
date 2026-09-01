import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RiskEngineService } from './risk-engine.service';
import { IngestSecurityEventsDto } from '../dto/security.dto';

@Injectable()
export class SecurityEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
  ) {}

  /**
   * Ingest a batch of security events with deduplication and idempotency
   */
  async ingestEvents(
    attemptId: string,
    dto: IngestSecurityEventsDto,
    userId: string,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        student: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (attempt.student?.userId !== userId && attempt.studentId !== userId) {
      throw new ForbiddenException('You do not own this attempt');
    }

    const events = dto.events || [];
    if (events.length === 0) {
      return {
        success: true,
        ingestedCount: 0,
        evaluation: await this.riskEngineService.evaluateAttemptSecurity(attemptId),
      };
    }

    const eventIds = events.map((e) => e.eventId);
    const existingEvents = await this.prisma.attemptEvent.findMany({
      where: {
        eventId: { in: eventIds },
      },
      select: { eventId: true },
    });

    const existingSet = new Set(existingEvents.map((e) => e.eventId));
    const newEvents = events.filter((e) => !existingSet.has(e.eventId));

    if (newEvents.length > 0) {
      const now = new Date();
      await this.prisma.attemptEvent.createMany({
        data: newEvents.map((e) => ({
          eventId: e.eventId,
          attemptId,
          examSessionId: dto.sessionId || null,
          eventType: e.eventType,
          sequenceNumber: e.sequenceNumber || 1,
          clientTimestamp: e.clientTimestamp ? new Date(e.clientTimestamp) : now,
          serverTimestamp: now,
          duration: e.duration || 0,
          metadata: e.metadata || {},
        })),
        skipDuplicates: true,
      });
    }

    // Trigger risk engine evaluation
    const evaluation = await this.riskEngineService.evaluateAttemptSecurity(attemptId);

    return {
      success: true,
      ingestedCount: newEvents.length,
      duplicateCount: events.length - newEvents.length,
      evaluation,
    };
  }

  /**
   * Get attempt security timeline and audit history
   */
  async getAttemptEvents(
    attemptId: string,
    userId: string,
    isAdmin: boolean = false,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        student: true,
        securityProfile: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    if (!isAdmin && attempt.student?.userId !== userId && attempt.studentId !== userId) {
      throw new ForbiddenException('You do not have access to these security events');
    }

    const events = await this.prisma.attemptEvent.findMany({
      where: { attemptId },
      orderBy: { serverTimestamp: 'asc' },
    });

    return {
      attemptId,
      profile: attempt.securityProfile,
      riskScore: attempt.riskScore,
      riskLevel: attempt.riskLevel,
      isFlagged: attempt.isFlagged,
      disqualifiedAt: attempt.disqualifiedAt,
      disqualificationReason: attempt.disqualificationReason,
      eventsCount: events.length,
      events,
    };
  }
}
