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
import { QuestionShuffleService } from './services/question-shuffle.service';
import { RedisService } from '../redis/redis.service';
import { ResultService } from '../result/result.service';
import { ResultReadinessService } from '../result/services/result-readiness.service';
import {
  StartAttemptDto,
  SaveAnswerDto,
  BulkSaveAnswersDto,
  SaveTimeLogDto,
} from './dto/attempt.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EVALUATION_QUEUE_NAME,
  ResultStatusEnum,
} from '../result/interfaces/result-lifecycle.interface';

@Injectable()
export class ExamAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly examService: ExamService,
    private readonly examAccessService: ExamAccessService,
    private readonly questionTimingService: QuestionTimingService,
    private readonly resultService: ResultService,
    private readonly resultReadinessService: ResultReadinessService,
    private readonly questionShuffleService: QuestionShuffleService,
    private readonly redisService: RedisService,
    @InjectQueue(EVALUATION_QUEUE_NAME)
    private readonly evaluationQueue: Queue,
  ) {}

  /**
   * Start a new exam attempt for a student.
   *
   * Gate checks (in order):
   *   1. Exam existence & active status
   *   2. Validate student access window & eligibility
   *   3. Validate chosen language is active & allowed for this exam
   *   4. Duplicate-attempt guard (allow recovery for INTERRUPTED / IN_PROGRESS)
   *   5. Server-side random seed generation
   *   6. Deterministic question and option shuffle per student
   *   7. Atomic persistence in PostgreSQL (Attempt, AttemptQuestion, AttemptQuestionOption)
   *   8. Warm active state in Redis
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

    // ── 2. Fetch exam for duration ──────────────────────────────────────
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
    });
    if (!exam) throw new NotFoundException('Exam not found');

    // ── 3. Validate chosen language ─────────────────────────────────────
    let resolvedLanguage = await this.prisma.preferredLanguage.findUnique({
      where: { id: dto.languageId },
    });
    if (!resolvedLanguage) {
      resolvedLanguage = await this.prisma.preferredLanguage.findFirst({
        where: {
          OR: [
            { code: dto.languageId.toLowerCase() },
            { code: dto.languageId.toUpperCase() },
          ],
        },
      });
    }
    if (!resolvedLanguage || !resolvedLanguage.isActive) {
      throw new BadRequestException(
        'Selected examination language is not valid or active.',
      );
    }

    const examLangCount = await this.prisma.examLanguage.count({
      where: { examId: dto.examId },
    });
    if (examLangCount > 0) {
      const isAllowed = await this.prisma.examLanguage.findFirst({
        where: { examId: dto.examId, languageId: resolvedLanguage.id },
      });
      if (!isAllowed) {
        throw new BadRequestException(
          `Language '${resolvedLanguage.name}' is not configured for this exam.`,
        );
      }
    }

    // ── 4a. Check for active attempts on other exams (One Active Attempt Rule) ──
    const now = new Date();
    const otherActiveAttempt = await this.prisma.attempt.findFirst({
      where: {
        studentId,
        examId: { not: dto.examId },
        status: { name: 'IN_PROGRESS' },
        serverEndTime: { gt: now },
      },
      include: { exam: { select: { title: true } } },
    });

    if (otherActiveAttempt) {
      throw new BadRequestException(
        `You already have an active exam in progress: "${otherActiveAttempt.exam.title}". You must finish or submit your active exam before starting another one.`,
      );
    }

    // ── 4b. Check for active (in-progress/interrupted) attempt to resume ───
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
      // If serverEndTime has already passed, finalize immediately and do not resume
      if (
        activeAttempt.serverEndTime &&
        now.getTime() >= activeAttempt.serverEndTime.getTime()
      ) {
        await this.submitAttempt(
          activeAttempt.id,
          studentId,
          'AUTO_SUBMIT_EXPIRED',
        );
        throw new ForbiddenException({
          code: 'EXAM_ATTEMPT_EXPIRED',
          message: 'The examination time for this attempt has expired.',
        });
      }

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

      await this.ensureAttemptQuestionsInitialized(
        activeAttempt.id,
        activeAttempt.examId,
        activeAttempt.randomSeed || 'default_seed',
      );

      return this.loadAttempt(activeAttempt.id);
    }

    // ── 4c. Single Attempt Rule for Live Exams ───
    const isLive = await this.resultReadinessService.isLiveExam(dto.examId);
    if (isLive) {
      const priorAttempt = await this.prisma.attempt.findFirst({
        where: {
          studentId,
          examId: dto.examId,
          status: {
            name: { in: ['SUBMITTED', 'AUTO_SUBMITTED', 'EVALUATED'] },
          },
        },
      });

      if (priorAttempt) {
        throw new ForbiddenException({
          code: 'LIVE_EXAM_ALREADY_SUBMITTED',
          message:
            'You have already submitted this live examination. Multiple attempts are not permitted for live exams.',
        });
      }
    }

    // ── 5. Prepare Exam Questions & Deterministic Randomization ─────────
    const inProgressStatus = await this.getStatus('IN_PROGRESS');

    const durationEnd = new Date(
      now.getTime() + exam.durationMinutes * 60 * 1000,
    );
    const windowEnd = new Date(access.endTime);
    const serverEndTime = durationEnd < windowEnd ? durationEnd : windowEnd;

    const randomSeed = this.questionShuffleService.generateAttemptSeed();

    const rawExamQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: dto.examId },
      include: {
        section: true,
        question: {
          include: {
            options: { orderBy: { displayOrder: 'asc' } },
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    if (rawExamQuestions.length === 0) {
      throw new BadRequestException('Exam has no questions configured.');
    }

    // Deterministically shuffle questions while preserving section order
    const shuffledQuestions = this.questionShuffleService.shuffleQuestions(
      rawExamQuestions,
      randomSeed,
      true,
    );

    // ── 6. Atomic Transaction: Persist Attempt & Personalized Order ───────
    let securityProfileId = exam.securityProfileId;
    let securityProfileVersion = 1;
    if (securityProfileId) {
      const sp = await this.prisma.examSecurityProfile.findUnique({
        where: { id: securityProfileId },
      });
      if (sp) securityProfileVersion = sp.version;
    } else {
      const standardProfile = await this.prisma.examSecurityProfile.findUnique({
        where: { code: 'STANDARD' },
      });
      if (standardProfile) {
        securityProfileId = standardProfile.id;
        securityProfileVersion = standardProfile.version;
      }
    }

    const attempt = await this.prisma.$transaction(async (tx) => {
      const newAttempt = await tx.attempt.create({
        data: {
          studentId,
          examId: dto.examId,
          statusId: inProgressStatus.id,
          languageId: resolvedLanguage.id,
          displayLanguageId: resolvedLanguage.id,
          randomSeed,
          securityProfileId: securityProfileId || null,
          securityProfileVersion,
          riskScore: 0,
          riskLevel: 'LOW',
          isFlagged: false,
          startedAt: now,
          serverStartTime: now,
          serverEndTime,
          ipAddress,
          scheduleId: access.scheduleId ?? null,
          examVersionId: access.examVersionId ?? null,
        },
      });

      for (let qIdx = 0; qIdx < shuffledQuestions.length; qIdx++) {
        const sq = shuffledQuestions[qIdx];
        const aq = await tx.attemptQuestion.create({
          data: {
            attemptId: newAttempt.id,
            examQuestionId: sq.id,
            displayOrder: qIdx + 1,
            sectionId: sq.sectionId ?? null,
          },
        });

        const shuffledOpts = this.questionShuffleService.shuffleOptions(
          sq.question?.options || [],
          randomSeed,
          sq.id,
        );

        if (shuffledOpts.length > 0) {
          await tx.attemptQuestionOption.createMany({
            data: shuffledOpts.map((opt, optIdx) => ({
              attemptQuestionId: aq.id,
              examQuestionOptionId: opt.id,
              displayOrder: optIdx + 1,
            })),
          });
        }
      }

      return newAttempt;
    });

    // ── 7. Warm Active State Cache in Redis ──────────────────────────────
    try {
      await this.redisService.set(
        `attempt:${attempt.id}:state`,
        JSON.stringify({
          attemptId: attempt.id,
          examId: attempt.examId,
          languageId: resolvedLanguage.id,
          status: 'IN_PROGRESS',
          startedAt: now.toISOString(),
          serverEndTime: serverEndTime.toISOString(),
        }),
        86400,
      );
    } catch {
      // Non-blocking Redis fallback
    }

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
   * Lightweight API: Validates ownership, locks status, saves answers,
   * dispatches BullMQ evaluation job (if Mock) or defers until scheduled window ends (if Live).
   */
  async submitAttempt(attemptId: string, studentId: string, reason: string = 'USER_SUBMIT') {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    this.verifyAttemptInProgress(attempt);

    const now = new Date();
    const inProgressStatus = await this.getStatus('IN_PROGRESS');
    const submittedStatus = await this.getStatus('SUBMITTED');

    // Atomic compare-and-swap: only transition if status is currently IN_PROGRESS
    const updateResult = await this.prisma.attempt.updateMany({
      where: {
        id: attemptId,
        statusId: inProgressStatus.id,
      },
      data: {
        statusId: submittedStatus.id,
        submittedAt: now,
      },
    });

    if (updateResult.count === 0) {
      // Race condition handled: another request or auto-submit already finalized this attempt
      const existing = await this.prisma.attempt.findUnique({
        where: { id: attemptId },
        include: { status: true, result: true },
      });
      return {
        attemptId,
        status: existing?.status?.name || 'SUBMITTED',
        resultStatus: existing?.result?.resultStatus || 'PROCESSING',
        message: 'Attempt already finalized.',
        submittedAt: existing?.submittedAt?.toISOString() || now.toISOString(),
      };
    }

    // Finalize any open active timing interval
    await this.questionTimingService
      .finalizeActiveTiming(attemptId, 'SUBMIT', now)
      .catch(() => {});

    // Clean up Redis session cache
    try {
      await this.redisService.del(`exam:attempt:${attemptId}:session`);
      await this.redisService.del(`exam:attempt:${attemptId}:heartbeat`);
    } catch {
      // Non-blocking
    }

    const isLive = await this.resultReadinessService.isLiveExam(attempt.examId);

    if (isLive) {
      // For Live/Scheduled exams: DO NOT evaluate immediately.
      // Create/update Result placeholder with PENDING_WINDOW_CLOSE status.
      await this.prisma.result.upsert({
        where: { attemptId },
        update: {
          resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
        },
        create: {
          attemptId,
          resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
          totalQuestions: 0,
          correctAnswers: 0,
          wrongAnswers: 0,
          unattempted: 0,
          totalScore: 0,
          maxScore: 0,
          percentage: 0,
          accuracy: 0,
          metadata: {
            deferred: true,
            reason: 'Awaiting scheduled examination window end',
            submissionReason: reason,
            submittedAt: now.toISOString(),
          },
        },
      });

      return {
        attemptId,
        status: 'SUBMITTED',
        resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
        message:
          'Attempt submitted successfully. Evaluation and ranking will begin after the scheduled examination window ends.',
        submittedAt: now.toISOString(),
      };
    }

    // ─── MOCK TEST: Immediate BullMQ Evaluation ───
    const evalJobId = `eval_${attemptId}`;
    try {
      await this.evaluationQueue.add(
        'EVALUATE_ATTEMPT',
        { attemptId, triggeredAt: now.toISOString(), evaluationMode: 'IMMEDIATE' },
        {
          jobId: evalJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
        },
      );
    } catch (queueErr) {
      // Fallback in case queue connection has transient glitch
      this.resultService.calculateResult(attemptId).catch(() => {});
    }

    return {
      attemptId,
      status: 'SUBMITTED',
      resultStatus: 'PROCESSING',
      message: 'Attempt submitted successfully and queued for evaluation.',
      submittedAt: now.toISOString(),
    };
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

    const now = new Date();
    const effectiveEndTime =
      attempt.serverEndTime && now > attempt.serverEndTime
        ? attempt.serverEndTime
        : now;

    const inProgressStatus = await this.getStatus('IN_PROGRESS');
    const autoSubmittedStatus = await this.getStatus('AUTO_SUBMITTED');

    // Atomic compare-and-swap
    const updateResult = await this.prisma.attempt.updateMany({
      where: {
        id: attemptId,
        statusId: inProgressStatus.id,
      },
      data: {
        statusId: autoSubmittedStatus.id,
        submittedAt: effectiveEndTime,
      },
    });

    if (updateResult.count === 0) {
      // Concurrently finalized by student submit or previous auto-submit
      return {
        attemptId,
        status: attempt.status.name,
        resultStatus: 'PROCESSING',
        message: 'Attempt already finalized.',
      };
    }

    // Finalize active timing interval up to expiration
    await this.questionTimingService
      .finalizeActiveTiming(attemptId, 'AUTO_SUBMIT', effectiveEndTime)
      .catch(() => {});

    // Clean up Redis session cache
    try {
      await this.redisService.del(`exam:attempt:${attemptId}:session`);
      await this.redisService.del(`exam:attempt:${attemptId}:heartbeat`);
    } catch {
      // Non-blocking
    }

    const isLive = await this.resultReadinessService.isLiveExam(attempt.examId);

    if (isLive) {
      // For Live/Scheduled exams: DO NOT evaluate immediately.
      // Create/update Result placeholder with PENDING_WINDOW_CLOSE status.
      await this.prisma.result.upsert({
        where: { attemptId },
        update: {
          resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
        },
        create: {
          attemptId,
          resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
          totalQuestions: 0,
          correctAnswers: 0,
          wrongAnswers: 0,
          unattempted: 0,
          totalScore: 0,
          maxScore: 0,
          percentage: 0,
          accuracy: 0,
          metadata: {
            deferred: true,
            autoSubmitted: true,
            reason: 'Awaiting scheduled examination window end',
            submittedAt: effectiveEndTime.toISOString(),
          },
        },
      });

      return {
        attemptId,
        status: 'AUTO_SUBMITTED',
        resultStatus: ResultStatusEnum.PENDING_WINDOW_CLOSE,
        message:
          'Attempt auto-submitted. Evaluation and ranking will begin after the scheduled examination window ends.',
        submittedAt: effectiveEndTime.toISOString(),
      };
    }

    // ─── MOCK TEST: Immediate BullMQ Evaluation ───
    const evalJobId = `eval_${attemptId}`;
    try {
      await this.evaluationQueue.add(
        'EVALUATE_ATTEMPT',
        { attemptId, triggeredAt: effectiveEndTime.toISOString(), evaluationMode: 'IMMEDIATE' },
        {
          jobId: evalJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
        },
      );
    } catch (queueErr) {
      this.resultService.calculateResult(attemptId).catch(() => {});
    }

    return {
      attemptId,
      status: 'AUTO_SUBMITTED',
      resultStatus: 'PROCESSING',
      message: 'Attempt auto-submitted and queued for evaluation.',
      submittedAt: effectiveEndTime.toISOString(),
    };
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
      data: {
        languageId: language.id,
        displayLanguageId: language.id,
      },
    });

    // 4. Update Redis active state
    try {
      const redisStateKey = `attempt:${attemptId}:state`;
      const cached = await this.redisService.get(redisStateKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.languageId = language.id;
        await this.redisService.set(redisStateKey, JSON.stringify(parsed), 86400);
      }
    } catch {
      // Non-blocking Redis fallback
    }

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
   * Idempotently ensures that AttemptQuestion & AttemptQuestionOption records are persisted in DB.
   */
  async ensureAttemptQuestionsInitialized(
    attemptId: string,
    examId: string,
    randomSeed: string,
  ) {
    const existingCount = await this.prisma.attemptQuestion.count({
      where: { attemptId },
    });
    if (existingCount > 0) return;

    const rawExamQuestions = await this.prisma.examQuestion.findMany({
      where: { examId },
      include: {
        section: true,
        question: {
          include: {
            options: { orderBy: { displayOrder: 'asc' } },
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    if (rawExamQuestions.length === 0) return;

    const shuffled = this.questionShuffleService.shuffleQuestions(
      rawExamQuestions,
      randomSeed,
      true,
    );

    for (let qIdx = 0; qIdx < shuffled.length; qIdx++) {
      const sq = shuffled[qIdx];
      const aq = await this.prisma.attemptQuestion.create({
        data: {
          attemptId,
          examQuestionId: sq.id,
          displayOrder: qIdx + 1,
          sectionId: sq.sectionId ?? null,
        },
      });

      const shuffledOpts = this.questionShuffleService.shuffleOptions(
        sq.question?.options || [],
        randomSeed,
        sq.id,
      );

      if (shuffledOpts.length > 0) {
        await this.prisma.attemptQuestionOption.createMany({
          data: shuffledOpts.map((opt, optIdx) => ({
            attemptQuestionId: aq.id,
            examQuestionOptionId: opt.id,
            displayOrder: optIdx + 1,
          })),
        });
      }
    }
  }

  /**
   * Get the exam questions for a specific attempt
   * (Returns student-specific deterministic question order & option order with localized language fallback).
   */
  async getAttemptQuestions(attemptId: string, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);

    // 1. Ensure AttemptQuestion & AttemptQuestionOption records exist for this attempt
    await this.ensureAttemptQuestionsInitialized(
      attempt.id,
      attempt.examId,
      attempt.randomSeed || 'default_seed',
    );

    // 2. Fetch personalized AttemptQuestion mappings ordered by displayOrder asc
    const attemptQuestions = await this.prisma.attemptQuestion.findMany({
      where: { attemptId: attempt.id },
      orderBy: { displayOrder: 'asc' },
      include: {
        options: {
          orderBy: { displayOrder: 'asc' },
        },
        examQuestion: {
          include: {
            section: { select: { id: true, name: true, subjectId: true } },
            question: {
              include: {
                questionType: { select: { id: true, name: true, code: true } },
                translations: {
                  include: {
                    language: { select: { id: true, code: true, name: true } },
                  },
                },
                options: {
                  include: {
                    translations: {
                      include: {
                        language: {
                          select: { id: true, code: true, name: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const examLanguages = await this.prisma.examLanguage.findMany({
      where: { examId: attempt.examId },
      orderBy: { isDefault: 'desc' },
    });
    const examDefaultLanguageId = examLanguages.find(
      (el) => el.isDefault,
    )?.languageId;
    const currentLanguageId = attempt.languageId;

    return attemptQuestions.map((aq) => {
      const eq = aq.examQuestion;
      const q = eq.question;

      // 4-Tier Translation Fallback:
      // 1. Attempt Language
      // 2. Exam Default Language
      // 3. Question Default Language
      // 4. First Available Translation
      const matchedTranslation =
        q.translations.find(
          (t) =>
            t.languageId === currentLanguageId ||
            t.language?.code === currentLanguageId,
        ) ||
        (examDefaultLanguageId
          ? q.translations.find((t) => t.languageId === examDefaultLanguageId)
          : null) ||
        q.translations.find((t) => t.languageId === q.defaultLanguageId) ||
        q.translations[0];

      // Build question translations map for instant client-side switching (indexed by ID & code)
      const qTranslationsMap: Record<
        string,
        {
          questionText: string;
          passageText?: string | null;
          assertionText?: string | null;
          reasonText?: string | null;
        }
      > = {};
      q.translations.forEach((t) => {
        const transObj = {
          questionText: t.questionText,
          passageText: t.passageText || null,
          assertionText: t.assertionText || null,
          reasonText: t.reasonText || null,
        };
        qTranslationsMap[t.languageId] = transObj;
        if (t.language?.code) {
          qTranslationsMap[t.language.code.toLowerCase()] = transObj;
        }
      });

      // Map options strictly according to AttemptQuestionOption.displayOrder
      const rawOptionsMap = new Map<string, any>(
        q.options.map((o) => [o.id, o]),
      );
      const orderedOptions = aq.options
        .map((aqo) => {
          const rawOpt = rawOptionsMap.get(aqo.examQuestionOptionId);
          if (!rawOpt) return null;

          const matchedOptTranslation =
            rawOpt.translations?.find(
              (ot: any) =>
                ot.languageId === currentLanguageId ||
                ot.language?.code === currentLanguageId,
            ) ||
            (examDefaultLanguageId
              ? rawOpt.translations?.find(
                  (ot: any) => ot.languageId === examDefaultLanguageId,
                )
              : null) ||
            rawOpt.translations?.find(
              (ot: any) => ot.languageId === q.defaultLanguageId,
            ) ||
            rawOpt.translations?.[0];

          const optTranslationsMap: Record<string, { optionText: string }> = {};
          (rawOpt.translations || []).forEach((ot: any) => {
            const optTransObj = {
              optionText:
                ot.optionText || rawOpt.optionText || rawOpt.optionLabel || '',
            };
            optTranslationsMap[ot.languageId] = optTransObj;
            if (ot.language?.code) {
              optTranslationsMap[ot.language.code.toLowerCase()] = optTransObj;
            }
          });

          return {
            id: rawOpt.id,
            attemptQuestionOptionId: aqo.id,
            displayOrder: aqo.displayOrder,
            optionKey: rawOpt.optionKey,
            optionLabel: rawOpt.optionLabel || rawOpt.optionKey || '',
            optionText:
              matchedOptTranslation?.optionText ||
              rawOpt.optionText ||
              rawOpt.optionLabel ||
              '',
            translations: optTranslationsMap,
          };
        })
        .filter(Boolean);

      return {
        attemptQuestionId: aq.id,
        examQuestionId: eq.id,
        questionId: q.id,
        displayOrder: aq.displayOrder,
        marks: eq.marks,
        negativeMarks: eq.negativeMarks,
        section: eq.section,
        type: q.type,
        questionType: q.questionType,
        passage: matchedTranslation?.passageText || q.passage || null,
        assertion: matchedTranslation?.assertionText || q.assertion || null,
        reason: matchedTranslation?.reasonText || q.reason || null,
        questionText:
          matchedTranslation?.questionText || (q as any).questionText || '',
        translations: qTranslationsMap,
        options: orderedOptions,
      };
    });
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
            sections: {
              include: {
                subject: { select: { id: true, name: true } },
              },
            },
          },
        },
        status: { select: { id: true, name: true } },
        result: {
          select: {
            id: true,
            totalScore: true,
            maxScore: true,
            percentage: true,
            accuracy: true,
            correctAnswers: true,
            wrongAnswers: true,
            unattempted: true,
            timeUsedSeconds: true,
            averageTimePerQuestion: true,
            resultStatus: true,
            subjectResults: {
              select: {
                id: true,
                subjectId: true,
                subject: { select: { id: true, name: true } },
                score: true,
                maxScore: true,
                accuracy: true,
                correctAnswers: true,
                wrongAnswers: true,
                unattempted: true,
              },
            },
          },
        },
        candidateRanks: {
          select: {
            rank: true,
            totalCandidates: true,
            percentile: true,
            rankType: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        timeAnalyses: {
          select: {
            averageTimePerQuestionSeconds: true,
            timeUtilizationPercentage: true,
            totalTimeUsedSeconds: true,
          },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        strategyAnalyses: {
          select: {
            primaryClassification: true,
            avoidableNegativeMarks: true,
            projectedScore: true,
          },
          take: 1,
          orderBy: { createdAt: 'desc' },
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
