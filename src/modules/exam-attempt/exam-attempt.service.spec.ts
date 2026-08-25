import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExamAttemptService } from './exam-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExamService } from '../exam/exam.service';
import { ExamAccessService } from '../exam-scheduling/services/exam-access.service';
import { QuestionTimingService } from '../time-analysis/services/question-timing.service';

// ─── Minimal Prisma Mock ──────────────────────────────────────────────────────
const prismaMock = {
  exam: { findUnique: jest.fn() },
  attempt: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  answer: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  questionTimeLog: { create: jest.fn() },
  attemptStatus: { findUnique: jest.fn() },
  preferredLanguage: { findUnique: jest.fn() },
  examLanguage: { count: jest.fn(), findFirst: jest.fn() },
};

// ─── Mock Services ────────────────────────────────────────────────────────────
const examServiceMock = {
  getExamQuestionsForAttempt: jest.fn(),
};

const examAccessServiceMock = {
  validateStudentAccess: jest.fn(),
};

const questionTimingServiceMock = {
  finalizeActiveTiming: jest.fn(),
};

// ─── Test Suite ───────────────────────────────────────────────────────────────
describe('ExamAttemptService', () => {
  let service: ExamAttemptService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamAttemptService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ExamService, useValue: examServiceMock },
        { provide: ExamAccessService, useValue: examAccessServiceMock },
        { provide: QuestionTimingService, useValue: questionTimingServiceMock },
      ],
    }).compile();

    service = module.get<ExamAttemptService>(ExamAttemptService);
    jest.clearAllMocks();
  });

  // ── startAttempt ─────────────────────────────────────────────────────────
  describe('startAttempt', () => {
    const studentId = 'student-uuid';
    const dto = { examId: 'exam-uuid', languageId: 'lang-uuid' };
    const accessResult = {
      isAllowed: true,
      examId: 'exam-uuid',
      examVersionId: 'version-uuid',
      scheduleId: 'schedule-uuid',
      serverTime: new Date(),
      startTime: new Date(),
      endTime: new Date(Date.now() + 7200000), // 2 hours
      timeRemainingSeconds: 7200,
    };
    const inProgressStatus = { id: 'status-uuid', name: 'IN_PROGRESS' };
    const exam = { id: 'exam-uuid', durationMinutes: 60, status: { name: 'ACTIVE' } };

    it('creates a new attempt when all checks pass', async () => {
      examAccessServiceMock.validateStudentAccess.mockResolvedValue(accessResult);
      prismaMock.exam.findUnique.mockResolvedValue(exam);
      prismaMock.attempt.findUnique.mockResolvedValue(null); // no existing
      prismaMock.attemptStatus.findUnique.mockResolvedValue(inProgressStatus);
      prismaMock.attempt.create.mockResolvedValue({ id: 'attempt-uuid' });
      prismaMock.attempt.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'attempt-uuid',
        exam: {},
        status: inProgressStatus,
        language: {},
        _count: { answers: 0 },
      });

      await service.startAttempt(dto, studentId, '127.0.0.1');

      expect(examAccessServiceMock.validateStudentAccess).toHaveBeenCalledWith(dto.examId, studentId);
      expect(prismaMock.attempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId,
            examId: dto.examId,
            scheduleId: accessResult.scheduleId,
            examVersionId: accessResult.examVersionId,
          }),
        }),
      );
    });

    it('throws ForbiddenException when ExamAccessService denies access', async () => {
      examAccessServiceMock.validateStudentAccess.mockRejectedValue(
        new ForbiddenException({ code: 'EXAM_NOT_ACTIVE', message: 'Not active' }),
      );

      await expect(service.startAttempt(dto, studentId)).rejects.toThrow(ForbiddenException);
      expect(prismaMock.attempt.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when attempt already exists and is SUBMITTED', async () => {
      examAccessServiceMock.validateStudentAccess.mockResolvedValue(accessResult);
      prismaMock.exam.findUnique.mockResolvedValue(exam);
      prismaMock.attempt.findUnique.mockResolvedValue({
        id: 'old-attempt',
        status: { name: 'SUBMITTED' },
        scheduleId: null,
        examVersionId: null,
      });

      await expect(service.startAttempt(dto, studentId)).rejects.toThrow(BadRequestException);
    });

    it('recovers an INTERRUPTED attempt and updates scheduleId', async () => {
      examAccessServiceMock.validateStudentAccess.mockResolvedValue(accessResult);
      prismaMock.exam.findUnique.mockResolvedValue(exam);
      const interruptedAttempt = {
        id: 'old-attempt',
        status: { name: 'INTERRUPTED' },
        scheduleId: null,
        examVersionId: null,
      };
      prismaMock.attempt.findUnique
        .mockResolvedValueOnce(interruptedAttempt)
        .mockResolvedValueOnce({ id: 'old-attempt', exam: {}, status: inProgressStatus, language: {}, _count: { answers: 0 } });
      prismaMock.attemptStatus.findUnique.mockResolvedValue(inProgressStatus);
      prismaMock.attempt.update.mockResolvedValue({});

      await service.startAttempt(dto, studentId);

      expect(prismaMock.attempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-attempt' },
          data: expect.objectContaining({
            scheduleId: accessResult.scheduleId,
            examVersionId: accessResult.examVersionId,
          }),
        }),
      );
      expect(prismaMock.attempt.create).not.toHaveBeenCalled();
    });

    it('clamps serverEndTime to window endTime when exam duration exceeds window', async () => {
      // Exam is 180 mins but window ends in 60 mins → clamp to 60 mins
      const shortWindowEnd = new Date(Date.now() + 3600000); // 1 hour
      examAccessServiceMock.validateStudentAccess.mockResolvedValue({
        ...accessResult,
        endTime: shortWindowEnd,
        timeRemainingSeconds: 3600,
      });
      prismaMock.exam.findUnique.mockResolvedValue({ ...exam, durationMinutes: 180 });
      prismaMock.attempt.findUnique.mockResolvedValueOnce(null);
      prismaMock.attemptStatus.findUnique.mockResolvedValue(inProgressStatus);
      prismaMock.attempt.create.mockResolvedValue({ id: 'attempt-uuid' });
      prismaMock.attempt.findUnique.mockResolvedValueOnce({
        id: 'attempt-uuid', exam: {}, status: inProgressStatus, language: {}, _count: { answers: 0 },
      });

      await service.startAttempt(dto, studentId);

      const createCall = prismaMock.attempt.create.mock.calls[0][0];
      const serverEndTime: Date = createCall.data.serverEndTime;

      // serverEndTime should be <= window end (within 1 second tolerance)
      expect(serverEndTime.getTime()).toBeLessThanOrEqual(shortWindowEnd.getTime() + 1000);
    });
  });

  // ── saveAnswer ───────────────────────────────────────────────────────────
  describe('saveAnswer', () => {
    const studentId = 'student-uuid';
    const attemptId = 'attempt-uuid';
    const inProgressAttempt = {
      id: attemptId,
      studentId,
      status: { name: 'IN_PROGRESS' },
      serverEndTime: new Date(Date.now() + 3600000),
    };

    it('upserts an answer when attempt is in progress', async () => {
      prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
      prismaMock.answer.upsert.mockResolvedValue({});

      const dto = { examQuestionId: 'q-uuid', selectedOptionId: 'opt-uuid' };
      const result = await service.saveAnswer(attemptId, dto, studentId);

      expect(prismaMock.answer.upsert).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Answer saved' });
    });

    it('throws ForbiddenException when student does not own attempt', async () => {
      prismaMock.attempt.findUnique.mockResolvedValue({
        ...inProgressAttempt,
        studentId: 'other-student',
      });

      await expect(
        service.saveAnswer(attemptId, { examQuestionId: 'q-uuid' }, studentId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when time has expired', async () => {
      prismaMock.attempt.findUnique.mockResolvedValue({
        ...inProgressAttempt,
        serverEndTime: new Date(Date.now() - 1000), // expired
      });
      prismaMock.attempt.update.mockResolvedValue({});
      prismaMock.attemptStatus.findUnique.mockResolvedValue({ id: 'x', name: 'AUTO_SUBMITTED' });

      await expect(
        service.saveAnswer(attemptId, { examQuestionId: 'q-uuid' }, studentId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── submitAttempt ────────────────────────────────────────────────────────
  describe('submitAttempt', () => {
    const studentId = 'student-uuid';
    const attemptId = 'attempt-uuid';
    const inProgressAttempt = {
      id: attemptId,
      studentId,
      status: { name: 'IN_PROGRESS' },
    };

    it('submits and returns the updated attempt', async () => {
      prismaMock.attempt.findUnique
        .mockResolvedValueOnce(inProgressAttempt)
        .mockResolvedValueOnce({ ...inProgressAttempt, status: { name: 'SUBMITTED' }, exam: {}, language: {}, _count: { answers: 0 } });
      prismaMock.attemptStatus.findUnique.mockResolvedValue({ id: 's-uuid', name: 'SUBMITTED' });
      prismaMock.attempt.update.mockResolvedValue({});

      const result = await service.submitAttempt(attemptId, studentId);
      expect(prismaMock.attempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ submittedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws BadRequestException when attempt is already submitted', async () => {
      prismaMock.attempt.findUnique.mockResolvedValue({
        ...inProgressAttempt,
        status: { name: 'SUBMITTED' },
      });

      await expect(service.submitAttempt(attemptId, studentId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── switchAttemptLanguage ────────────────────────────────────────────────
  describe('switchAttemptLanguage', () => {
    const studentId = 'student-uuid';
    const attemptId = 'attempt-uuid';
    const languageId = 'lang-uuid';

    const inProgressAttempt = {
      id: attemptId,
      studentId,
      examId: 'exam-uuid',
      status: { name: 'IN_PROGRESS' },
      serverEndTime: new Date(Date.now() + 3600000),
    };

    it('switches language atomically with no state loss', async () => {
      prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
      prismaMock.preferredLanguage.findUnique.mockResolvedValue({
        id: languageId, code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', isActive: true,
      });
      prismaMock.examLanguage.count.mockResolvedValue(0); // no restrictions
      prismaMock.attempt.update.mockResolvedValue({});

      const result = await service.switchAttemptLanguage(attemptId, languageId, studentId);

      expect(prismaMock.attempt.update).toHaveBeenCalledWith({
        where: { id: attemptId },
        data: { languageId },
      });
      expect(result.language.code).toBe('hi');
    });

    it('throws BadRequestException for inactive language', async () => {
      prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
      prismaMock.preferredLanguage.findUnique.mockResolvedValue({
        id: languageId, isActive: false,
      });

      await expect(
        service.switchAttemptLanguage(attemptId, languageId, studentId),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
