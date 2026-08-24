import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExamService } from '../exam/exam.service';
import { StartAttemptDto, SaveAnswerDto, BulkSaveAnswersDto, SaveTimeLogDto } from './dto/attempt.dto';

@Injectable()
export class ExamAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly examService: ExamService,
  ) {}

  /**
   * Start a new exam attempt for a student
   */
  async startAttempt(dto: StartAttemptDto, studentId: string, ipAddress?: string) {
    // 1. Verify exam is ACTIVE
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
      include: { status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'ACTIVE') {
      throw new BadRequestException('This exam is not currently active');
    }

    // 2. Check if student already has an attempt
    const existing = await this.prisma.attempt.findUnique({
      where: { studentId_examId: { studentId, examId: dto.examId } },
      include: { status: true },
    });

    if (existing) {
      // Allow recovery for interrupted attempts
      if (['INTERRUPTED', 'IN_PROGRESS'].includes(existing.status.name)) {
        const inProgressStatus = await this.getStatus('IN_PROGRESS');
        await this.prisma.attempt.update({
          where: { id: existing.id },
          data: { statusId: inProgressStatus.id },
        });
        return this.loadAttempt(existing.id);
      }
      throw new BadRequestException('You have already attempted this exam');
    }

    // 3. Create new attempt
    const inProgressStatus = await this.getStatus('IN_PROGRESS');
    const now = new Date();
    const serverEndTime = new Date(now.getTime() + exam.durationMinutes * 60 * 1000);

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
      },
    });

    return this.loadAttempt(attempt.id);
  }

  /**
   * Save a single answer (idempotent upsert)
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
   * Bulk save multiple answers at once (auto-save scenario)
   */
  async bulkSaveAnswers(attemptId: string, dto: BulkSaveAnswersDto, studentId: string) {
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
   * Save time log for a question
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
   * Submit the exam attempt (student-initiated)
   */
  async submitAttempt(attemptId: string, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    this.verifyAttemptInProgress(attempt);

    const submittedStatus = await this.getStatus('SUBMITTED');
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        statusId: submittedStatus.id,
        submittedAt: new Date(),
      },
    });

    return this.loadAttempt(attemptId);
  }

  /**
   * Auto-submit attempt when timer expires (called by server or client)
   */
  async autoSubmitAttempt(attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { status: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status.name !== 'IN_PROGRESS') return;

    const autoSubmittedStatus = await this.getStatus('AUTO_SUBMITTED');
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        statusId: autoSubmittedStatus.id,
        submittedAt: new Date(),
      },
    });

    return this.loadAttempt(attemptId);
  }

  /**
   * Get attempt status and answers for the exam interface
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
      answers,
    };
  }

  /**
   * Get the exam questions for a specific attempt (includes language filtering)
   */
  async getAttemptQuestions(attemptId: string, studentId: string) {
    const attempt = await this.verifyAttemptOwnership(attemptId, studentId);
    return this.examService.getExamQuestionsForAttempt(attempt.examId, attempt.languageId);
  }

  /**
   * Get student's exam history
   */
  async getStudentAttempts(studentId: string) {
    return this.prisma.attempt.findMany({
      where: { studentId },
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

  private async verifyAttemptOwnership(attemptId: string, studentId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { status: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.studentId !== studentId) {
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
      // Auto-submit if time has expired
      this.autoSubmitAttempt(attempt.id).catch(() => {});
      throw new BadRequestException('Exam time has expired');
    }
  }

  private async getStatus(name: string) {
    const status = await this.prisma.attemptStatus.findUnique({ where: { name } });
    if (!status) throw new BadRequestException(`Attempt status ${name} not found. Run seeds.`);
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
