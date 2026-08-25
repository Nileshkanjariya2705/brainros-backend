import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ParentStudentAccessService } from './services/parent-student-access.service';
import { ParentDashboardService } from './services/parent-dashboard.service';
import { StudentTrendService } from '../performance-trend/services/student-trend.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const prismaMock = {
  student: {
    findFirst: jest.fn(),
  },
  parentStudentLink: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  attempt: {
    findMany: jest.fn(),
  },
  examSchedule: {
    count: jest.fn().mockResolvedValue(10),
  },
};

const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
};

const studentTrendServiceMock = {
  getStudentTrends: jest.fn(),
};

describe('Parent Dashboard & Access Security', () => {
  let accessService: ParentStudentAccessService;
  let dashboardService: ParentDashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentStudentAccessService,
        ParentDashboardService,
        { provide: StudentTrendService, useValue: studentTrendServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    accessService = module.get<ParentStudentAccessService>(ParentStudentAccessService);
    dashboardService = module.get<ParentDashboardService>(ParentDashboardService);
    jest.clearAllMocks();
  });

  describe('ParentStudentAccessService (Anti-IDOR & Authorization)', () => {
    it('allows access when an ACTIVE ParentStudentLink exists', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'STU101',
        name: 'Rohan Sharma',
      });
      prismaMock.parentStudentLink.findUnique.mockResolvedValue({
        parentId: 'parent-1',
        studentId: 'student-1',
        status: 'ACTIVE',
      });

      const student = await accessService.assertCanAccessStudent('parent-1', 'student-1');
      expect(student).toBeDefined();
      expect(student.id).toBe('student-1');
    });

    it('denies access (throws ForbiddenException) when no link exists (IDOR attempt)', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-2',
        studentId: 'STU102',
        name: 'Other Student',
      });
      prismaMock.parentStudentLink.findUnique.mockResolvedValue(null);

      await expect(accessService.assertCanAccessStudent('parent-1', 'student-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('denies access when relationship status is REVOKED', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'STU101',
        name: 'Rohan Sharma',
      });
      prismaMock.parentStudentLink.findUnique.mockResolvedValue({
        parentId: 'parent-1',
        studentId: 'student-1',
        status: 'REVOKED',
      });

      await expect(accessService.assertCanAccessStudent('parent-1', 'student-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('denies access when relationship status is PENDING', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'STU101',
        name: 'Rohan Sharma',
      });
      prismaMock.parentStudentLink.findUnique.mockResolvedValue({
        parentId: 'parent-1',
        studentId: 'student-1',
        status: 'PENDING',
      });

      await expect(accessService.assertCanAccessStudent('parent-1', 'student-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('ParentDashboardService Aggregation', () => {
    it('aggregates student performance metrics, subjects, attendance, timing, and parent recommendations', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        studentId: 'STU101',
        name: 'Rohan Sharma',
        schoolCollege: 'Delhi Public School',
        examTarget: { name: 'NEET' },
        studentClass: { name: 'Class 12' },
      });

      prismaMock.parentStudentLink.findUnique.mockResolvedValue({
        parentId: 'parent-1',
        studentId: 'student-1',
        status: 'ACTIVE',
      });

      const mockAttempts = [
        {
          id: 'att-1',
          createdAt: new Date('2026-08-01T10:00:00Z'),
          serverEndTime: new Date('2026-08-01T13:00:00Z'),
          exam: { title: 'Mock 1', totalMarks: 720, examTarget: { name: 'NEET' } },
          result: {
            totalScore: 480,
            percentage: 66.67,
            accuracy: 72.5,
            subjectResults: [
              { subjectId: 'sub-1', subject: { name: 'Physics' }, score: 100, maxScore: 180, accuracy: 60.0 },
              { subjectId: 'sub-2', subject: { name: 'Biology' }, score: 160, maxScore: 180, accuracy: 90.0 },
            ],
          },
          candidateRanks: [{ rank: 1240, percentile: 89.67, totalCandidates: 12000 }],
          timeAnalyses: [{ averageTimePerQuestionSeconds: 58.4, timeUtilizationPercentage: 91.3 }],
          predictionResults: [{ predictedRankMin: 120, predictedRankMax: 170, confidence: 'MEDIUM', modelVersion: 'v1.0.0' }],
        },
        {
          id: 'att-2',
          createdAt: new Date('2026-08-15T10:00:00Z'),
          serverEndTime: new Date('2026-08-15T13:00:00Z'),
          exam: { title: 'Mock 2', totalMarks: 720, examTarget: { name: 'NEET' } },
          result: {
            totalScore: 586,
            percentage: 81.38,
            accuracy: 84.1,
            subjectResults: [
              { subjectId: 'sub-1', subject: { name: 'Physics' }, score: 120, maxScore: 180, accuracy: 67.8 },
              { subjectId: 'sub-2', subject: { name: 'Biology' }, score: 170, maxScore: 180, accuracy: 94.4 },
            ],
          },
          candidateRanks: [{ rank: 145, percentile: 97.8, totalCandidates: 12500 }],
          timeAnalyses: [{ averageTimePerQuestionSeconds: 54.0, timeUtilizationPercentage: 88.0 }],
          predictionResults: [{ predictedRankMin: 120, predictedRankMax: 170, confidence: 'MEDIUM', modelVersion: 'v1.0.0' }],
        },
      ];

      prismaMock.attempt.findMany.mockResolvedValue(mockAttempts);

      const dashboard = await dashboardService.getStudentDashboard('parent-1', 'student-1');

      expect(dashboard.student.name).toBe('Rohan Sharma');
      expect(dashboard.summary.testsAttempted).toBe(2);
      expect(dashboard.summary.latestScore).toBe(586);
      expect(dashboard.summary.bestScore).toBe(586);
      expect(dashboard.summary.scoreImprovement).toBe(106); // 586 - 480
      expect(dashboard.summary.latestRank).toBe(145);
      expect(dashboard.summary.latestPercentile).toBe(97.8);

      // Subjects
      expect(dashboard.subjects.strongest?.name).toBe('Biology');
      expect(dashboard.subjects.strongest?.accuracy).toBe(94.4);
      expect(dashboard.subjects.weakest?.name).toBe('Physics');
      expect(dashboard.subjects.weakest?.accuracy).toBe(67.8);

      // Recommendations
      expect(dashboard.recommendations).toHaveLength(2);
      expect(dashboard.recommendations[0].title).toContain('Physics');

      // Recent Tests
      expect(dashboard.recentTests).toHaveLength(2);
    });
  });
});
