import { Test, TestingModule } from '@nestjs/testing';
import { CompletedExamReportsService } from './completed-exam-reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/services/audit-log.service';
import { ResultService } from '../../result/result.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('CompletedExamReportsService', () => {
  let service: CompletedExamReportsService;
  let prisma: any;
  let emailQueue: any;
  let auditLogService: any;
  let resultService: any;

  beforeEach(async () => {
    prisma = {
      exam: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      attempt: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      student: {
        count: jest.fn(),
      },
      result: {
        aggregate: jest.fn(),
      },
      notification: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    emailQueue = {
      add: jest.fn(),
    };

    auditLogService = {
      logAction: jest.fn(),
    };

    resultService = {
      getFullAnalysis: jest.fn(),
      getAnswerReview: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletedExamReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: ResultService, useValue: resultService },
        { provide: getQueueToken('exam-report-email'), useValue: emailQueue },
      ],
    }).compile();

    service = module.get<CompletedExamReportsService>(CompletedExamReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCompletedLiveExams', () => {
    it('should filter out mock tests and return completed live exams', async () => {
      const pastDate = new Date(Date.now() - 3600000);
      prisma.exam.findMany.mockResolvedValue([
        {
          id: 'live-exam-1',
          title: 'NEET Grand Live Exam 01',
          endTime: pastDate,
          status: { name: 'COMPLETED' },
          schedules: [{ status: 'ENDED', endTime: pastDate }],
          resultPublications: [{ status: 'PUBLISHED' }],
          _count: { attempts: 150 },
        },
        {
          id: 'mock-exam-2',
          title: 'NEET Mock Practice Test 01',
          endTime: pastDate,
          status: { name: 'COMPLETED' },
          schedules: [],
          resultPublications: [],
          _count: { attempts: 20 },
        },
      ]);

      const result = await service.getCompletedLiveExams();

      expect(result.length).toEqual(1);
      expect(result[0].id).toEqual('live-exam-1');
      expect(result[0].title).toEqual('NEET Grand Live Exam 01');
    });
  });

  describe('getLiveExamSummary', () => {
    it('should aggregate registration, attendance, scores, and accuracy', async () => {
      prisma.exam.findUnique.mockResolvedValue({
        id: 'live-exam-1',
        title: 'NEET Grand Live Exam 01',
        examTargetId: 'target-1',
        totalMarks: 720,
        totalQuestions: 180,
        schedules: [],
        resultPublications: [{ status: 'PUBLISHED' }],
      });

      prisma.student.count.mockResolvedValue(500);
      prisma.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          status: { name: 'SUBMITTED' },
          result: { resultStatus: 'PUBLISHED' },
        },
        {
          id: 'att-2',
          status: { name: 'AUTO_SUBMITTED' },
          result: { resultStatus: 'PUBLISHED' },
        },
      ]);

      prisma.result.aggregate.mockResolvedValue({
        _avg: { totalScore: 450, accuracy: 75.5, percentage: 62.5 },
        _max: { totalScore: 680 },
        _min: { totalScore: 210 },
      });

      const summary = await service.getLiveExamSummary('live-exam-1');

      expect(summary.examId).toEqual('live-exam-1');
      expect(summary.metrics.attended).toEqual(2);
      expect(summary.metrics.submitted).toEqual(1);
      expect(summary.metrics.autoSubmitted).toEqual(1);
      expect(summary.metrics.averageScore).toEqual('450.0');
      expect(summary.publication.status).toEqual('PUBLISHED');
    });
  });

  describe('queueReportEmail', () => {
    it('should resolve student email server-side and enqueue BullMQ job', async () => {
      prisma.attempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        examId: 'exam-1',
        studentId: 'student-1',
        exam: {
          title: 'NEET Live Exam',
          resultPublications: [{ status: 'PUBLISHED' }],
        },
        student: {
          id: 'student-1',
          name: 'Rahul Patel',
          userId: 'user-1',
          user: {
            id: 'user-1',
            email: 'rahul.patel@example.com',
            phone: '9876543210',
          },
        },
        result: {
          totalScore: 500,
          maxScore: 720,
        },
      });

      prisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        status: 'PENDING',
      });

      emailQueue.add.mockResolvedValue({ id: 'bullmq-job-1' });

      const res = await service.queueReportEmail('exam-1', 'attempt-1', { id: 'admin-1' });

      expect(res.success).toBe(true);
      expect(res.status).toEqual('QUEUED');
      expect(res.recipientEmail).toEqual('rahul.patel@example.com');
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-student-report-email',
        expect.objectContaining({
          attemptId: 'attempt-1',
          recipientEmail: 'rahul.patel@example.com',
        }),
        expect.anything(),
      );
    });
  });
});
