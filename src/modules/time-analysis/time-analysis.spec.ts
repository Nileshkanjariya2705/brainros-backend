import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { QuestionTimingService } from './services/question-timing.service';
import { TimeAnalysisService } from './services/time-analysis.service';
import { RedisTimingStore } from './stores/redis-timing.store';
import { PrismaService } from '../prisma/prisma.service';

const prismaMock = {
  attempt: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  examQuestion: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  questionTimeLog: {
    aggregate: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  timeAnalysis: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

const timingStoreMock = {
  getActiveTiming: jest.fn(),
  setActiveTiming: jest.fn(),
  clearActiveTiming: jest.fn(),
  recordProcessedEvent: jest.fn(),
  getCachedAnalysis: jest.fn(),
  setCachedAnalysis: jest.fn(),
  invalidateAnalysisCache: jest.fn(),
};

describe('Time Analysis Subsystem', () => {
  let timingService: QuestionTimingService;
  let analysisService: TimeAnalysisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionTimingService,
        TimeAnalysisService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisTimingStore, useValue: timingStoreMock },
      ],
    }).compile();

    timingService = module.get<QuestionTimingService>(QuestionTimingService);
    analysisService = module.get<TimeAnalysisService>(TimeAnalysisService);
    jest.clearAllMocks();
  });

  describe('QuestionTimingService', () => {
    const studentId = 'student-123';
    const attemptId = 'attempt-123';
    const inProgressAttempt = {
      id: attemptId,
      studentId,
      examId: 'exam-123',
      status: { name: 'IN_PROGRESS' },
      startedAt: new Date(Date.now() - 60000),
      serverEndTime: new Date(Date.now() + 3600000), // 1 hr remaining
    };

    describe('startQuestionTiming', () => {
      it('starts a new question timing interval and records active state in Redis', async () => {
        prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
        prismaMock.examQuestion.findFirst.mockResolvedValue({ id: 'eq-1', examId: 'exam-123' });
        timingStoreMock.recordProcessedEvent.mockResolvedValue(true);
        timingStoreMock.getActiveTiming.mockResolvedValue(null);
        prismaMock.questionTimeLog.aggregate.mockResolvedValue({ _max: { visitNumber: 0 } });
        timingStoreMock.setActiveTiming.mockResolvedValue(undefined);

        const res = await timingService.startQuestionTiming(
          attemptId,
          { examQuestionId: 'eq-1', eventId: 'evt-1' },
          studentId,
        );

        expect(res.attemptId).toBe(attemptId);
        expect(res.examQuestionId).toBe('eq-1');
        expect(res.visitNumber).toBe(1);
        expect(timingStoreMock.setActiveTiming).toHaveBeenCalledWith(
          attemptId,
          expect.objectContaining({
            examQuestionId: 'eq-1',
            visitNumber: 1,
          }),
        );
      });

      it('auto-closes previous active question when transitioning to a new question', async () => {
        prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
        prismaMock.examQuestion.findFirst.mockResolvedValue({ id: 'eq-2', examId: 'exam-123' });
        timingStoreMock.recordProcessedEvent.mockResolvedValue(true);

        const currentActive = {
          attemptId,
          examQuestionId: 'eq-1',
          visitNumber: 1,
          serverStartedAt: new Date(Date.now() - 30000).toISOString(),
          serverRevision: 1,
        };
        timingStoreMock.getActiveTiming.mockResolvedValue(currentActive);
        prismaMock.questionTimeLog.create.mockResolvedValue({ id: 'log-1', timeSpentSeconds: 30 });
        prismaMock.questionTimeLog.aggregate.mockResolvedValue({ _max: { visitNumber: 0 } });
        timingStoreMock.setActiveTiming.mockResolvedValue(undefined);

        const res = await timingService.startQuestionTiming(
          attemptId,
          { examQuestionId: 'eq-2', eventId: 'evt-2' },
          studentId,
        );

        // Auto-close eq-1
        expect(prismaMock.questionTimeLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              examQuestionId: 'eq-1',
              source: 'SERVER_TRANSITION',
            }),
          }),
        );

        // Start eq-2
        expect(res.examQuestionId).toBe('eq-2');
        expect(res.visitNumber).toBe(1);
      });

      it('deduplicates start events and returns existing state without incrementing visit count', async () => {
        prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
        prismaMock.examQuestion.findFirst.mockResolvedValue({ id: 'eq-1', examId: 'exam-123' });
        timingStoreMock.recordProcessedEvent.mockResolvedValue(false); // duplicate!
        const existingActive = {
          attemptId,
          examQuestionId: 'eq-1',
          visitNumber: 1,
          serverStartedAt: new Date().toISOString(),
          serverRevision: 1,
        };
        timingStoreMock.getActiveTiming.mockResolvedValue(existingActive);

        const res = await timingService.startQuestionTiming(
          attemptId,
          { examQuestionId: 'eq-1', eventId: 'evt-dup' },
          studentId,
        );

        expect(res.visitNumber).toBe(1);
        expect(prismaMock.questionTimeLog.create).not.toHaveBeenCalled();
      });

      it('rejects start timing if attempt has expired', async () => {
        const expiredAttempt = {
          ...inProgressAttempt,
          serverEndTime: new Date(Date.now() - 1000), // expired!
        };
        prismaMock.attempt.findUnique.mockResolvedValue(expiredAttempt);
        prismaMock.examQuestion.findFirst.mockResolvedValue({ id: 'eq-1', examId: 'exam-123' });

        await expect(
          timingService.startQuestionTiming(attemptId, { examQuestionId: 'eq-1' }, studentId),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('endQuestionTiming', () => {
      it('closes the active interval and clears active state from Redis', async () => {
        prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
        const currentActive = {
          attemptId,
          examQuestionId: 'eq-1',
          visitNumber: 1,
          serverStartedAt: new Date(Date.now() - 45000).toISOString(),
          serverRevision: 1,
        };
        timingStoreMock.getActiveTiming.mockResolvedValue(currentActive);
        prismaMock.questionTimeLog.create.mockResolvedValue({
          id: 'log-1',
          timeSpentSeconds: 45,
          endTime: new Date(),
          source: 'CLIENT_EVENT',
        });
        timingStoreMock.clearActiveTiming.mockResolvedValue(undefined);

        const res = await timingService.endQuestionTiming(
          attemptId,
          { examQuestionId: 'eq-1' },
          studentId,
        );

        expect(res.timeSpentSeconds).toBe(45);
        expect(timingStoreMock.clearActiveTiming).toHaveBeenCalledWith(attemptId);
      });
    });

    describe('finalizeActiveTiming', () => {
      it('finalizes active question with fixed end time on SUBMIT', async () => {
        prismaMock.attempt.findUnique.mockResolvedValue(inProgressAttempt);
        const currentActive = {
          attemptId,
          examQuestionId: 'eq-1',
          visitNumber: 2,
          serverStartedAt: new Date(Date.now() - 20000).toISOString(),
          serverRevision: 2,
        };
        timingStoreMock.getActiveTiming.mockResolvedValue(currentActive);
        prismaMock.questionTimeLog.create.mockResolvedValue({});
        timingStoreMock.clearActiveTiming.mockResolvedValue(undefined);

        const submitTime = new Date();
        await timingService.finalizeActiveTiming(attemptId, 'SUBMIT', submitTime);

        expect(prismaMock.questionTimeLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              examQuestionId: 'eq-1',
              source: 'SUBMIT',
            }),
          }),
        );
        expect(timingStoreMock.clearActiveTiming).toHaveBeenCalledWith(attemptId);
      });
    });
  });

  describe('TimeAnalysisService', () => {
    const attemptId = 'attempt-123';
    const mockAttempt = {
      id: attemptId,
      examId: 'exam-123',
      startedAt: new Date(Date.now() - 3600000),
      submittedAt: new Date(),
      exam: {
        id: 'exam-123',
        title: 'JEE Mock Test',
        durationMinutes: 60,
        totalQuestions: 60,
        sections: [{ id: 'sec-1', name: 'Physics', subjectId: 'sub-1' }],
      },
      timeLogs: [
        { examQuestionId: 'eq-1', startTime: new Date(), endTime: new Date(), timeSpentSeconds: 40, visitNumber: 1 },
        { examQuestionId: 'eq-1', startTime: new Date(), endTime: new Date(), timeSpentSeconds: 20, visitNumber: 2 },
        { examQuestionId: 'eq-2', startTime: new Date(), endTime: new Date(), timeSpentSeconds: 150, visitNumber: 1 },
      ],
      answers: [
        { examQuestionId: 'eq-1', selectedOptionId: 'opt-1', isMarkedForReview: true },
        { examQuestionId: 'eq-2', selectedOptionId: 'opt-wrong', isMarkedForReview: false },
      ],
    };

    const mockExamQuestions = [
      {
        id: 'eq-1',
        displayOrder: 1,
        section: { id: 'sec-1', name: 'Physics', subjectId: 'sub-1' },
        question: {
          id: 'q-1',
          questionType: { code: 'SCQ' },
          chapter: { id: 'chap-1', name: 'Kinematics', subject: { name: 'Physics' } },
          options: [{ id: 'opt-1', isCorrect: true }],
        },
      },
      {
        id: 'eq-2',
        displayOrder: 2,
        section: { id: 'sec-1', name: 'Physics', subjectId: 'sub-1' },
        question: {
          id: 'q-2',
          questionType: { code: 'SCQ' },
          chapter: { id: 'chap-2', name: 'Thermodynamics', subject: { name: 'Physics' } },
          options: [{ id: 'opt-2-correct', isCorrect: true }, { id: 'opt-wrong', isCorrect: false }],
        },
      },
    ];

    it('generates full detailed time analysis with fastest, slowest, and wasted time', async () => {
      timingStoreMock.getCachedAnalysis.mockResolvedValue(null);
      prismaMock.timeAnalysis.findUnique.mockResolvedValue(null);
      prismaMock.attempt.findUnique.mockResolvedValue(mockAttempt);
      prismaMock.examQuestion.findMany.mockResolvedValue(mockExamQuestions);
      prismaMock.timeAnalysis.upsert.mockResolvedValue({});
      timingStoreMock.setCachedAnalysis.mockResolvedValue(undefined);

      const res = await analysisService.generateTimeAnalysis(attemptId, 1);

      expect(res.attemptId).toBe(attemptId);
      expect(res.totalTimeAvailableSeconds).toBe(3600);
      expect(res.questions).toHaveLength(2);

      // eq-1 has 2 visits (40s + 20s = 60s total)
      const q1 = res.questions.find((q) => q.examQuestionId === 'eq-1');
      expect(q1?.totalTimeSpentSeconds).toBe(60);
      expect(q1?.visitCount).toBe(2);
      expect(q1?.initialVisitTimeSeconds).toBe(40);
      expect(q1?.reviewTimeSeconds).toBe(20);
      expect(q1?.answerStatus).toBe('CORRECT');

      // eq-2 has 150s, wrong answer
      const q2 = res.questions.find((q) => q.examQuestionId === 'eq-2');
      expect(q2?.totalTimeSpentSeconds).toBe(150);
      expect(q2?.answerStatus).toBe('WRONG');
      expect(q2?.timeWastedSeconds).toBeGreaterThan(0);

      // Fastest & Slowest
      expect(res.fastestQuestion?.examQuestionId).toBe('eq-1');
      expect(res.slowestQuestion?.examQuestionId).toBe('eq-2');

      // Subjects
      expect(res.subjects).toHaveLength(1);
      expect(res.subjects[0].subjectName).toBe('Physics');

      // Caching
      expect(prismaMock.timeAnalysis.upsert).toHaveBeenCalled();
      expect(timingStoreMock.setCachedAnalysis).toHaveBeenCalled();
    });
  });
});
