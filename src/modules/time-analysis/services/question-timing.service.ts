import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisTimingStore } from '../stores/redis-timing.store';
import {
  StartQuestionTimingDto,
  EndQuestionTimingDto,
  TimeSyncDto,
} from '../dto/time-tracking.dto';
import {
  ActiveTimingState,
  AuthoritativeTimingResponse,
  ClosedTimingResponse,
} from '../interfaces/time-analysis.interface';

@Injectable()
export class QuestionTimingService {
  private readonly logger = new Logger(QuestionTimingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timingStore: RedisTimingStore,
  ) {}

  /**
   * Start question timing (server-authoritative).
   *
   * Flow:
   * 1. Authenticate attempt & student ownership.
   * 2. Verify attempt status is IN_PROGRESS.
   * 3. Verify question belongs to attempt exam.
   * 4. Check time expiry (auto-submit if expired).
   * 5. If eventId provided, perform atomic deduplication.
   * 6. If another question is currently active, AUTO-CLOSE it first using current server timestamp!
   * 7. Calculate new visitNumber and persist active state in Redis.
   * 8. Return authoritative server time sync.
   */
  async startQuestionTiming(
    attemptId: string,
    dto: StartQuestionTimingDto,
    studentId: string,
  ): Promise<AuthoritativeTimingResponse> {
    const serverNow = new Date();
    const attempt = await this.verifyAttempt(attemptId, studentId);
    this.verifyInProgress(attempt);

    const examQuestionId = dto.examQuestionId || '';

    // 1. Verify question belongs to this exam
    const examQuestion = await this.prisma.examQuestion.findFirst({
      where: { id: examQuestionId, examId: attempt.examId },
    });
    if (!examQuestion) {
      throw new NotFoundException(
        'Question does not belong to this exam attempt',
      );
    }

    // 2. Check server-authoritative time expiry
    const isExpired = attempt.serverEndTime
      ? serverNow > attempt.serverEndTime
      : false;
    if (isExpired) {
      await this.finalizeActiveTiming(
        attemptId,
        'AUTO_SUBMIT',
        attempt.serverEndTime!,
      );
      throw new BadRequestException(
        'Exam time has expired. Question timing cannot be started.',
      );
    }

    // 3. Event Deduplication
    if (dto.eventId) {
      const isNewEvent = await this.timingStore.recordProcessedEvent(
        attemptId,
        dto.eventId,
      );
      if (!isNewEvent) {
        // Return existing active state idempotently
        const current = await this.timingStore.getActiveTiming(attemptId);
        if (current && current.examQuestionId === examQuestionId) {
          return this.formatTimingResponse(
            attempt,
            current.examQuestionId,
            current.visitNumber,
            current.serverStartedAt,
          );
        }
      }
    }

    // 4. Retrieve current active state in Redis
    const currentActive = await this.timingStore.getActiveTiming(attemptId);

    // If currently active on the SAME question
    if (currentActive && currentActive.examQuestionId === examQuestionId) {
      return this.formatTimingResponse(
        attempt,
        currentActive.examQuestionId,
        currentActive.visitNumber,
        currentActive.serverStartedAt,
      );
    }

    // If active on a DIFFERENT question -> Auto-close the previous question interval
    if (currentActive && currentActive.examQuestionId !== examQuestionId) {
      await this.closeIntervalInternal(
        attempt,
        currentActive,
        serverNow,
        'SERVER_TRANSITION',
      );
    }

    // 5. Determine Visit Number for this question
    const maxVisit = await this.prisma.questionTimeLog.aggregate({
      where: { attemptId, examQuestionId },
      _max: { visitNumber: true },
    });
    const visitNumber = (maxVisit._max.visitNumber || 0) + 1;

    // 6. Set New Active Timing State in Redis
    const activeState: ActiveTimingState = {
      attemptId,
      examQuestionId,
      visitNumber,
      serverStartedAt: serverNow.toISOString(),
      serverRevision: (currentActive?.serverRevision || 0) + 1,
      lastEventId: dto.eventId,
      clientTimestamp: dto.clientTimestamp,
      clientSequence: dto.clientSequence,
      metadata: dto.metadata,
    };

    await this.timingStore.setActiveTiming(attemptId, activeState);

    return this.formatTimingResponse(
      attempt,
      examQuestionId,
      visitNumber,
      serverNow.toISOString(),
    );
  }

  /**
   * End question timing (explicit close from client).
   */
  async endQuestionTiming(
    attemptId: string,
    dto: EndQuestionTimingDto,
    studentId: string,
  ): Promise<ClosedTimingResponse> {
    const serverNow = new Date();
    const attempt = await this.verifyAttempt(attemptId, studentId);
    const examQuestionId = dto.examQuestionId || '';

    const currentActive = await this.timingStore.getActiveTiming(attemptId);
    if (!currentActive || currentActive.examQuestionId !== examQuestionId) {
      // Nothing active or mismatched question -> check DB for recent unclosed interval
      return {
        attemptId,
        examQuestionId,
        visitNumber: 1,
        timeSpentSeconds: 0,
        serverEndTime: serverNow.toISOString(),
        source: 'NO_ACTIVE_INTERVAL',
      };
    }

    const log = await this.closeIntervalInternal(
      attempt,
      currentActive,
      serverNow,
      'CLIENT_EVENT',
      dto.eventId,
      dto.clientTimestamp,
      dto.clientSequence,
      dto.metadata,
    );

    await this.timingStore.clearActiveTiming(attemptId);

    return {
      attemptId,
      examQuestionId: dto.examQuestionId,
      visitNumber: currentActive.visitNumber,
      timeSpentSeconds: log.timeSpentSeconds,
      serverEndTime: log.endTime
        ? log.endTime.toISOString()
        : serverNow.toISOString(),
      source: log.source,
    };
  }

  /**
   * Synchronize / Query active timing state
   */
  async getActiveTimingSync(
    attemptId: string,
    studentId: string,
    dto?: TimeSyncDto,
  ): Promise<AuthoritativeTimingResponse | null> {
    const attempt = await this.verifyAttempt(attemptId, studentId);
    const currentActive = await this.timingStore.getActiveTiming(attemptId);

    if (!currentActive) {
      const serverNow = new Date();
      const timeRemaining = attempt.serverEndTime
        ? Math.max(
            0,
            Math.floor(
              (attempt.serverEndTime.getTime() - serverNow.getTime()) / 1000,
            ),
          )
        : 0;
      return {
        attemptId,
        examQuestionId: '',
        visitNumber: 0,
        serverTime: serverNow.toISOString(),
        serverStartTime: attempt.startedAt
          ? attempt.startedAt.toISOString()
          : serverNow.toISOString(),
        serverEndTime: attempt.serverEndTime
          ? attempt.serverEndTime.toISOString()
          : null,
        timeRemainingSeconds: timeRemaining,
        isExpired: timeRemaining <= 0,
        activeQuestionId: '',
      };
    }

    return this.formatTimingResponse(
      attempt,
      currentActive.examQuestionId,
      currentActive.visitNumber,
      currentActive.serverStartedAt,
    );
  }

  /**
   * Finalize all active timing on Submit or Auto-Submit
   */
  async finalizeActiveTiming(
    attemptId: string,
    source: 'SUBMIT' | 'AUTO_SUBMIT' | 'RECOVERY',
    fixedEndTime?: Date,
  ): Promise<void> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) return;

    const currentActive = await this.timingStore.getActiveTiming(attemptId);
    if (currentActive) {
      const serverEnd = fixedEndTime || new Date();
      await this.closeIntervalInternal(
        attempt,
        currentActive,
        serverEnd,
        source,
      );
      await this.timingStore.clearActiveTiming(attemptId);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Closes an active interval and persists QuestionTimeLog
   */
  private async closeIntervalInternal(
    attempt: any,
    active: ActiveTimingState,
    serverEnd: Date,
    source: string,
    eventId?: string,
    clientTimestamp?: string,
    clientSequence?: number,
    metadata?: any,
  ) {
    const startedAt = new Date(active.serverStartedAt);
    let effectiveEnd = serverEnd;

    // Enforce attempt expiry boundary (never count past serverEndTime)
    if (attempt.serverEndTime && effectiveEnd > attempt.serverEndTime) {
      effectiveEnd = attempt.serverEndTime;
    }

    // Clamp non-negative
    const timeSpentSeconds = Math.max(
      0,
      Math.floor((effectiveEnd.getTime() - startedAt.getTime()) / 1000),
    );

    return this.prisma.questionTimeLog.create({
      data: {
        attemptId: attempt.id,
        examQuestionId: active.examQuestionId,
        startTime: startedAt,
        endTime: effectiveEnd,
        timeSpentSeconds,
        visitNumber: active.visitNumber,
        source,
        eventId: eventId || active.lastEventId || null,
        clientTimestamp: clientTimestamp
          ? new Date(clientTimestamp)
          : active.clientTimestamp
            ? new Date(active.clientTimestamp)
            : null,
        clientSequence: clientSequence ?? active.clientSequence ?? null,
        metadata: metadata || active.metadata || null,
      },
    });
  }

  private async verifyAttempt(attemptId: string, studentIdOrUserId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        status: true,
        student: { select: { id: true, userId: true } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (
      attempt.studentId !== studentIdOrUserId &&
      attempt.student?.userId !== studentIdOrUserId
    ) {
      throw new ForbiddenException('You do not own this attempt');
    }
    return attempt;
  }

  private verifyInProgress(attempt: any) {
    if (attempt.status.name !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Attempt is in '${attempt.status.name}' status. Timing only allowed for IN_PROGRESS attempts.`,
      );
    }
  }

  private formatTimingResponse(
    attempt: any,
    examQuestionId: string,
    visitNumber: number,
    serverStartTime: string,
  ): AuthoritativeTimingResponse {
    const serverNow = new Date();
    const timeRemaining = attempt.serverEndTime
      ? Math.max(
          0,
          Math.floor(
            (attempt.serverEndTime.getTime() - serverNow.getTime()) / 1000,
          ),
        )
      : 0;

    return {
      attemptId: attempt.id,
      examQuestionId,
      visitNumber,
      serverTime: serverNow.toISOString(),
      serverStartTime,
      serverEndTime: attempt.serverEndTime
        ? attempt.serverEndTime.toISOString()
        : null,
      timeRemainingSeconds: timeRemaining,
      isExpired: timeRemaining <= 0,
      activeQuestionId: examQuestionId,
    };
  }
}
