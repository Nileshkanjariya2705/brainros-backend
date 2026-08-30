import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExamService } from '../exam/exam.service';
import { ExamAccessService } from '../exam-scheduling/services/exam-access.service';
import { QuestionTimingService } from '../time-analysis/services/question-timing.service';
import {
  StartAttemptDto,
  SaveAnswerDto,
  BulkSaveAnswersDto,
  SaveTimeLogDto,
} from './dto/attempt.dto';
import { ResultService } from '../result/result.service';

@Injectable()
export class ExamAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly examService: ExamService,
    private readonly examAccessService: ExamAccessService,
    private readonly questionTimingService: QuestionTimingService,
    private readonly resultService: ResultService,
  ) {}

  /**
   * Start a new exam attempt for a student.
   *
   * Gate checks (in order):
   *   1. Exam existence
   *   2. ExamAccessService.validateStudentAccess() — enforces ACTIVE status,
   *      schedule window (startTime <= now < endTime), student eligibility
   *   3. Duplicate-attempt guard (allow recovery for INTERRUPTED / IN_PROGRESS)
   *   4. Create attempt bound to the active scheduleId + examVersionId
   */
  async startAttempt(
    dto: StartAttemptDto,
    studentId: string,
    ipAddress?: string,
  ) {
    // ── 1. Validate access (scheduling window + lifecycle + eligibility) ──
    const access = await this.examAccessService.validateStudentAccess(
      dto.examId,
      studentId,
    );
    // access.isAllowed is guaranteed true here (throws ForbiddenException otherwise)

    // ── 2. Fetch exam for duration ──────────────────────────────────────
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
    });
    if (!exam) throw new NotFoundException('Exam not found');

    // ── 3. Check for active (in-progress/interrupted) attempt to resume ───
    const activeAttempt = await this.prisma.attempt.findFirst({
      where: {
        studentId,
        examId: dto.examId,
        status: { name: { in: ['INTERRUPTED', 'IN_PROGRESS'] } },
      },
      include: { status: true },
      orderBy: { createdAt: 'desc' },
    });

    if (activeAttempt) {
      // Allow seamless recovery for interrupted/in-progress attempts
      const inProgressStatus = await this.getStatus('IN_PROGRESS');
      await this.prisma.attempt.update({
        where: { id: activeAttempt.id },
        data: {
          statusId: inProgressStatus.id,
          // Refresh schedule / version binding on recovery if exam was re-scheduled
          scheduleId: access.scheduleId ?? activeAttempt.scheduleId,
          examVersionId: access.examVersionId ?? activeAttempt.examVersionId,
        },
      });
      return this.loadAttempt(activeAttempt.id);
    }

    // ── 4. Create new attempt ───────────────────────────────────────────
    const inProgressStatus = await this.getStatus('IN_PROGRESS');
    const now = new Date();

    // Server-authoritative end time:
    // min(examDuration from now, live window end) — whichever is sooner
    const durationEnd = new Date(
      now.getTime() + exam.durationMinutes * 60 * 1000,
    );
    const windowEnd = new Date(access.endTime);
    const serverEndTime = durationEnd < windowEnd ? durationEnd : windowEnd;

    const attempt = await this.prisma.attempt.create({
      data: {
        studentId,
        examId: dto.examId,
        statusId: inProgressStatus.id,
        languageId: dto.languageId,
        startedAt: now,
        serverStartTime: now,
        serverEndTime,
        ipAddress,
        // Bind to active scheduling artefacts for full audit trail
        scheduleId: access.scheduleId ?? null,
        examVersionId: access.examVersionId ?? null,
      },
    });

    return this.loadAttempt(attempt.id);
  }

  /**
   * Save a single answer (idempotent upsert).
   */
  async saveAnswer(attemptId: string, dto: SaveAnswerDto, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    this.verifyAttemptInProgress(attempt);
    this.checkTimeExpiry(attempt);

    await this.prisma.answer.upsert({
      where: {
        attemptId_examQuestionId: {
          attemptId,
          examQuestionId: dto.examQuestionId,
        },
      },
      update: {
        selectedOptionId: dto.selectedOptionId ?? null,
        numericalAnswer: dto.numericalAnswer ?? null,
        selectedOptions: dto.selectedOptions ?? Prisma.JsonNull,
        isMarkedForReview: dto.isMarkedForReview ?? false,
        answeredAt: new Date(),
      },
      create: {
        attemptId,
        examQuestionId: dto.examQuestionId,
        selectedOptionId: dto.selectedOptionId ?? null,
        numericalAnswer: dto.numericalAnswer ?? null,
        selectedOptions: dto.selectedOptions ?? Prisma.JsonNull,
        isMarkedForReview: dto.isMarkedForReview ?? false,
        answeredAt: new Date(),
      },
    });

    return { message: 'Answer saved' };
  }

  /**
   * Bulk save multiple answers at once (auto-save scenario).
   * Does NOT check time expiry — client handles timer; partial saves are fine.
   */
  async bulkSaveAnswers(
    attemptId: string,
    dto: BulkSaveAnswersDto,
    studentId: string,
  ) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    this.verifyAttemptInProgress(attempt);

    for (const answer of dto.answers) {
      await this.prisma.answer.upsert({
        where: {
          attemptId_examQuestionId: {
            attemptId,
            examQuestionId: answer.examQuestionId,
          },
        },
        update: {
          selectedOptionId: answer.selectedOptionId ?? null,
          numericalAnswer: answer.numericalAnswer ?? null,
          selectedOptions: answer.selectedOptions ?? Prisma.JsonNull,
          isMarkedForReview: answer.isMarkedForReview ?? false,
          answeredAt: new Date(),
        },
        create: {
          attemptId,
          examQuestionId: answer.examQuestionId,
          selectedOptionId: answer.selectedOptionId ?? null,
          numericalAnswer: answer.numericalAnswer ?? null,
          selectedOptions: answer.selectedOptions ?? Prisma.JsonNull,
          isMarkedForReview: answer.isMarkedForReview ?? false,
          answeredAt: new Date(),
        },
      });
    }

    return { message: `${dto.answers.length} answers saved` };
  }

  /**
   * Save per-question time log (analytics).
   */
  async saveTimeLog(attemptId: string, dto: SaveTimeLogDto, studentId: string) {
    await this.verifyAttemptOwnership(attemptId, studentId);

    await this.prisma.questionTimeLog.create({
      data: {
        attemptId,
        examQuestionId: dto.examQuestionId,
        startTime: new Date(dto.startTime),
        endTime: dto.endTime ? new Date(dto.endTime) : null,
        timeSpentSeconds: dto.timeSpentSeconds ?? 0,
      },
    });

    return { message: 'Time log saved' };
  }

  /**
   * Student-initiated exam submission.
   */
  async submitAttempt(attemptId: string, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    this.verifyAttemptInProgress(attempt);

    // Finalize any open active timing interval
    const now = new Date();
    await this.questionTimingService.finalizeActiveTiming(
      attemptId,
      'SUBMIT',
      now,
    );

    const submittedStatus = await this.getStatus('SUBMITTED');
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        statusId: submittedStatus.id,
        submittedAt: now,
      },
    });

    // Auto calculate result immediately on submission
    try {
      await this.resultService.calculateResult(attemptId);
    } catch (err) {
      // Non-blocking fallback
    }

    return this.loadAttempt(attemptId);
  }

  /**
   * Auto-submit when timer expires (called by server or client).
   * Idempotent — safe to call multiple times.
   */
  async autoSubmitAttempt(attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { status: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status.name !== 'IN_PROGRESS') return;

    const now = new Date();
    const effectiveEndTime =
      attempt.serverEndTime && now > attempt.serverEndTime
        ? attempt.serverEndTime
        : now;

    // Finalize active timing interval up to expiration
    await this.questionTimingService.finalizeActiveTiming(
      attemptId,
      'AUTO_SUBMIT',
      effectiveEndTime,
    );

    const autoSubmittedStatus = await this.getStatus('AUTO_SUBMITTED');
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        statusId: autoSubmittedStatus.id,
        submittedAt: effectiveEndTime,
      },
    });

    // Auto calculate result immediately on auto-submit
    try {
      await this.resultService.calculateResult(attemptId);
    } catch (err) {
      // Non-blocking fallback
    }

    return this.loadAttempt(attemptId);
  }

  /**
   * Get attempt status + saved answers for the exam interface.
   */
  async getAttemptStatus(attemptId: string, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);

    const answers = await this.prisma.answer.findMany({
      where: { attemptId },
      select: {
        examQuestionId: true,
        selectedOptionId: true,
        numericalAnswer: true,
        selectedOptions: true,
        isMarkedForReview: true,
        answeredAt: true,
      },
    });

    return {
      attemptId: attempt.id,
      examId: attempt.examId,
      status: attempt.status.name,
      startedAt: attempt.startedAt,
      serverEndTime: attempt.serverEndTime,
      scheduleId: attempt.scheduleId,
      examVersionId: attempt.examVersionId,
      answers,
    };
  }

  /**
   * Seamless in-flight language switch during an active exam attempt
   * (Zero reset of timer, answers, or attempt identity).
   */
  async switchAttemptLanguage(
    attemptId: string,
    languageIdOrCode: string,
    studentId: string,
  ) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    this.verifyAttemptInProgress(attempt);
    this.checkTimeExpiry(attempt);

    // 1. Verify language exists & is active (supports ID or code like 'hi', 'en', 'gu')
    let language = await this.prisma.preferredLanguage.findUnique({
      where: { id: languageIdOrCode },
    });
    if (!language) {
      language = await this.prisma.preferredLanguage.findFirst({
        where: {
          OR: [
            { code: languageIdOrCode.toLowerCase() },
            { code: languageIdOrCode.toUpperCase() },
          ],
        },
      });
    }
    if (!language || !language.isActive) {
      throw new BadRequestException(
        'The selected language is not active or available.',
      );
    }

    // 2. Verify language is allowed for this exam (if ExamLanguage configured)
    const examLanguageCount = await this.prisma.examLanguage.count({
      where: { examId: attempt.examId },
    });

    if (examLanguageCount > 0) {
      const isAllowed = await this.prisma.examLanguage.findFirst({
        where: { examId: attempt.examId, languageId: language.id },
      });
      if (!isAllowed) {
        throw new BadRequestException(
          `Language '${language.name}' is not enabled for this exam.`,
        );
      }
    }

    // 3. Atomically update selected language on Attempt record
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { languageId: language.id },
    });

    return {
      attemptId,
      language: {
        id: language.id,
        code: language.code,
        name: language.name,
        nativeName: language.nativeName,
      },
    };
  }

  /**
   * Get the exam questions for a specific attempt
   * (includes language filtering & 4-tier fallback).
   */
  async getAttemptQuestions(attemptId: string, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    return this.examService.getExamQuestionsForAttempt(
      attempt.examId,
      attempt.languageId,
    );
  }

  /**
   * Get student's full exam attempt history.
   */
  async getStudentAttempts(studentId?: string | null, userId?: string | null) {
    let resolvedStudentId = studentId;

    if (!resolvedStudentId && userId) {
      const student = await this.prisma.student.findUnique({
        where: { userId },
        select: { id: true },
      });
      resolvedStudentId = student?.id ?? null;
    }

    // If user has no associated student profile, return empty array cleanly
    if (!resolvedStudentId) {
      return [];
    }

    return this.prisma.attempt.findMany({
      where: { studentId: resolvedStudentId },
      orderBy: { createdAt: 'desc' },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalQuestions: true,
            totalMarks: true,
            durationMinutes: true,
            examTarget: { select: { id: true, name: true } },
          },
        },
        status: { select: { id: true, name: true } },
        result: {
          select: {
            totalScore: true,
            maxScore: true,
            percentage: true,
            correctAnswers: true,
            wrongAnswers: true,
            unattempted: true,
          },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════

  private async verifyAttemptOwnership(
    attemptId: string,
    studentIdOrUserId: string,
  ) {
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

  private verifyAttemptInProgress(attempt: any) {
    if (attempt.status.name !== 'IN_PROGRESS') {
      throw new BadRequestException('This attempt is not in progress');
    }
  }

  private checkTimeExpiry(attempt: any) {
    if (attempt.serverEndTime && new Date() > attempt.serverEndTime) {
      // Lazy auto-submit on expiry
      this.autoSubmitAttempt(attempt.id).catch(() => {});
      throw new BadRequestException(
        'Exam time has expired. Your answers have been auto-submitted.',
      );
    }
  }

  private async getStatus(name: string) {
    const status = await this.prisma.attemptStatus.findUnique({
      where: { name },
    });
    if (!status)
      throw new BadRequestException(
        `Attempt status '${name}' not found. Run seeds.`,
      );
    return status;
  }

  private async loadAttempt(id: string) {
    return this.prisma.attempt.findUnique({
      where: { id },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalQuestions: true,
            totalMarks: true,
            durationMinutes: true,
          },
        },
        status: { select: { id: true, name: true } },
        language: { select: { id: true, name: true } },
        _count: { select: { answers: true } },
      },
    });
  }
}
