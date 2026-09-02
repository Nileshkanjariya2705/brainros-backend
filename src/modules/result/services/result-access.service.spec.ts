import { Test, TestingModule } from '@nestjs/testing';
import { ResultAccessService } from './result-access.service';
import { ResultReadinessService } from './result-readiness.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  ResultProcessingStatus,
  ResultPublicationStatus,
  ReportFileStatus,
} from '../interfaces/result-lifecycle.interface';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('ResultAccessService (authoritative result availability and access control)', () => {
  let service: ResultAccessService;
  let readinessService: ResultReadinessService;

  const mockPrisma = {
    attempt: {
      findUnique: jest.fn(),
    },
    parentStudentLink: {
      findFirst: jest.fn(),
    },
    institutionAdmin: {
      findFirst: jest.fn(),
    },
    batchStudent: {
      findFirst: jest.fn(),
    },
    reportJob: {
      findFirst: jest.fn(),
    },
    result: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };

  const mockReadinessService = {
    isLiveExam: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultAccessService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: ResultReadinessService, useValue: mockReadinessService },
      ],
    }).compile();

    service = module.get<ResultAccessService>(ResultAccessService);
    readinessService = module.get<ResultReadinessService>(ResultReadinessService);
    jest.clearAllMocks();
  });

  const studentUser = { userId: 'user-stu-1', role: 'STUDENT', studentId: 'stu-1' };
  const adminUser = { userId: 'user-admin-1', role: 'ADMIN' };
  const parentUser = { userId: 'user-parent-1', role: 'PARENT' };

  describe('Test 1 & 3 — Existing Completed DB Result with No BullMQ Job (Bug 1 Fix)', () => {
    it('returns reportAvailable = true immediately when Result exists in PostgreSQL', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(false); // Mock test
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-101',
        studentId: 'stu-1',
        examId: 'exam-mock-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET Mock 01', schedules: [] },
        status: { name: 'SUBMITTED' },
        result: {
          id: 'res-101',
          attemptId: 'att-101',
          totalScore: 650,
          maxScore: 720,
          totalQuestions: 180,
          resultStatus: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });

      const res = await service.getResultStatus(studentUser, 'att-101');

      expect(res.processingStatus).toBe(ResultProcessingStatus.COMPLETED);
      expect(res.publicationStatus).toBe(ResultPublicationStatus.PUBLISHED);
      expect(res.resultAvailable).toBe(true);
      expect(res.reportAvailable).toBe(true);
      expect(res.availability).toBe('PUBLISHED');
      expect(res.message).toBe('Result is published and available.');
    });
  });

  describe('Test 2 — Processing Result (Not Yet Calculated)', () => {
    it('returns processingStatus = PROCESSING and reportAvailable = false', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(false);
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-102',
        studentId: 'stu-1',
        examId: 'exam-mock-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET Mock 01', schedules: [] },
        status: { name: 'SUBMITTED' },
        result: null, // Not yet calculated
      });

      const res = await service.getResultStatus(studentUser, 'att-102');

      expect(res.processingStatus).toBe(ResultProcessingStatus.PROCESSING);
      expect(res.resultAvailable).toBe(false);
      expect(res.reportAvailable).toBe(false);
      expect(res.availability).toBe('PROCESSING');
      expect(res.message).toContain('being calculated');
    });
  });

  describe('Test 4 — Failed Result', () => {
    it('returns FAILED without exposing stack traces', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(false);
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-104',
        studentId: 'stu-1',
        examId: 'exam-mock-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET Mock 01', schedules: [] },
        status: { name: 'FAILED' },
        result: null,
      });

      const res = await service.getResultStatus(studentUser, 'att-104');

      expect(res.processingStatus).toBe(ResultProcessingStatus.FAILED);
      expect(res.resultAvailable).toBe(false);
      expect(res.reportAvailable).toBe(false);
      expect(res.availability).toBe('FAILED');
    });
  });

  describe('Test 7 — Mock Test Auto-Publish', () => {
    it('automatically treats calculated Mock results as PUBLISHED even if raw DB status was EVALUATED', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(false); // MOCK
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-107',
        studentId: 'stu-1',
        examId: 'exam-mock-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET Mock 01', schedules: [] },
        status: { name: 'SUBMITTED' },
        result: {
          id: 'res-107',
          attemptId: 'att-107',
          totalScore: 590,
          maxScore: 720,
          totalQuestions: 180,
          resultStatus: 'EVALUATED', // Raw status before worker completion
        },
      });

      const res = await service.getResultStatus(studentUser, 'att-107');

      expect(res.processingStatus).toBe(ResultProcessingStatus.COMPLETED);
      expect(res.publicationStatus).toBe(ResultPublicationStatus.PUBLISHED);
      expect(res.reportAvailable).toBe(true);
      expect(res.availability).toBe('PUBLISHED');
    });
  });

  describe('Test 8 — Live Exam Ready-To-Publish (Anti-Leakage Protection)', () => {
    it('keeps official report hidden from student when Live result is calculated but not yet published by Super Admin', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(true); // LIVE
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-108',
        studentId: 'stu-1',
        examId: 'exam-live-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET All India Live Exam 2026', schedules: [{ id: 'sch-1' }] },
        status: { name: 'SUBMITTED' },
        result: {
          id: 'res-108',
          attemptId: 'att-108',
          totalScore: 680,
          maxScore: 720,
          totalQuestions: 180,
          resultStatus: 'READY_TO_PUBLISH',
        },
      });

      // Student perspective
      const res = await service.getResultStatus(studentUser, 'att-108');

      expect(res.processingStatus).toBe(ResultProcessingStatus.COMPLETED);
      expect(res.publicationStatus).toBe(ResultPublicationStatus.READY_TO_PUBLISH);
      expect(res.resultAvailable).toBe(true); // System knows result is calculated!
      expect(res.reportAvailable).toBe(false); // Hidden from student!
      expect(res.availability).toBe('RESULT_PENDING'); // Proper messaging
      expect(res.message).toContain('Official results will be released upon publication');

      // Admin perspective: Admin CAN inspect calculated report
      const adminRes = await service.getResultStatus(adminUser, 'att-108');
      expect(adminRes.reportAvailable).toBe(true);
    });
  });

  describe('Test 9 — Live Exam Super Admin Publish', () => {
    it('shows report to student once Super Admin publishes the Live exam', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(true); // LIVE
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-109',
        studentId: 'stu-1',
        examId: 'exam-live-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET All India Live Exam 2026', schedules: [{ id: 'sch-1' }] },
        status: { name: 'SUBMITTED' },
        result: {
          id: 'res-109',
          attemptId: 'att-109',
          totalScore: 680,
          maxScore: 720,
          totalQuestions: 180,
          resultStatus: 'PUBLISHED', // Published by Super Admin!
          publishedAt: new Date(),
        },
      });

      const res = await service.getResultStatus(studentUser, 'att-109');

      expect(res.processingStatus).toBe(ResultProcessingStatus.COMPLETED);
      expect(res.publicationStatus).toBe(ResultPublicationStatus.PUBLISHED);
      expect(res.reportAvailable).toBe(true);
      expect(res.availability).toBe('PUBLISHED');
    });
  });

  describe('Test 10 — PDF Missing Does NOT Hide Online Result', () => {
    it('online report is visible immediately when result is calculated, even if PDF generation is not started or processing', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(false);
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-110',
        studentId: 'stu-1',
        examId: 'exam-mock-1',
        student: { userId: 'user-stu-1' },
        exam: { title: 'NEET Mock 01', schedules: [] },
        status: { name: 'SUBMITTED' },
        result: {
          id: 'res-110',
          attemptId: 'att-110',
          totalScore: 610,
          maxScore: 720,
          totalQuestions: 180,
          resultStatus: 'PUBLISHED',
        },
      });

      // No PDF report job exists
      mockPrisma.reportJob.findFirst.mockResolvedValue(null);

      const res = await service.getResultStatus(studentUser, 'att-110');

      expect(res.onlineReportAvailable).toBe(true);
      expect(res.reportAvailable).toBe(true);
      expect(res.pdfReportStatus).toBe(ReportFileStatus.REPORT_NOT_GENERATED);
    });
  });

  describe('Parent & Institution Access Control', () => {
    it('allows parent with active ParentStudentLink to access student result', async () => {
      mockReadinessService.isLiveExam.mockResolvedValue(false);
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-parent-1',
        studentId: 'stu-child-1',
        examId: 'exam-mock-1',
        student: { userId: 'user-child-1' },
        exam: { title: 'NEET Mock' },
        status: { name: 'SUBMITTED' },
        result: {
          totalScore: 600,
          maxScore: 720,
          totalQuestions: 180,
          resultStatus: 'PUBLISHED',
        },
      });

      mockPrisma.parentStudentLink.findFirst.mockResolvedValue({
        id: 'link-1',
        parentId: 'user-parent-1',
        studentId: 'stu-child-1',
        status: 'ACTIVE',
      });

      const res = await service.getResultStatus(parentUser, 'att-parent-1');
      expect(res.reportAvailable).toBe(true);
    });

    it('rejects unauthorized users attempting to access another student result', async () => {
      mockPrisma.attempt.findUnique.mockResolvedValue({
        id: 'att-unauth-1',
        studentId: 'stu-other',
        examId: 'exam-mock-1',
        student: { userId: 'user-other' },
      });

      const stranger = { userId: 'user-stranger', role: 'STUDENT' };

      await expect(service.verifyAttemptAccess(stranger, 'att-unauth-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
