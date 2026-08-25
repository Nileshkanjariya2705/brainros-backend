import { Test, TestingModule } from '@nestjs/testing';
import { AdminDashboardService } from './admin-dashboard.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

describe('AdminDashboardService (Cross-Domain Aggregation & Caching)', () => {
  let service: AdminDashboardService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      user: { count: jest.fn().mockResolvedValue(100) },
      student: { count: jest.fn().mockResolvedValue(80) },
      parentStudentLink: { count: jest.fn().mockResolvedValue(20) },
      userRole: { count: jest.fn().mockResolvedValue(5) },
      institutionAdmin: { count: jest.fn().mockResolvedValue(4) },
      question: { count: jest.fn().mockResolvedValue(500) },
      questionTranslation: { count: jest.fn().mockResolvedValue(200) },
      preferredLanguage: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l-1', code: 'hi', name: 'Hindi', isActive: true },
          { id: 'l-2', code: 'gu', name: 'Gujarati', isActive: true },
        ]),
      },
      exam: { count: jest.fn().mockResolvedValue(25) },
      attempt: { count: jest.fn().mockResolvedValue(1500) },
      result: {
        aggregate: jest.fn().mockResolvedValue({
          _avg: { totalScore: 180, percentage: 72.5, accuracy: 81.2 },
          _count: { id: 1200 },
        }),
      },
      institution: { count: jest.fn().mockResolvedValue(10) },
      institutionBatch: { count: jest.fn().mockResolvedValue(30) },
      batchStudent: { count: jest.fn().mockResolvedValue(600) },
      reportJob: { count: jest.fn().mockResolvedValue(5) },
      approvalRequest: {
        count: jest.fn().mockResolvedValue(8),
        groupBy: jest.fn().mockResolvedValue([
          { resourceType: 'QUESTION', _count: { id: 5 } },
          { resourceType: 'EXAM', _count: { id: 3 } },
        ]),
      },
    };

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<AdminDashboardService>(AdminDashboardService);
  });

  it('should calculate complete dashboard operational KPIs across 10 modules', async () => {
    const res = await service.getDashboardOverview();

    expect(res.users.total).toBe(100);
    expect(res.questions.total).toBe(500);
    expect(res.translations.supportedLanguagesCount).toBe(2);
    expect(res.exams.total).toBe(25);
    expect(res.attempts.total).toBe(1500);
    expect(res.evaluation.totalEvaluated).toBe(1200);
    expect(res.evaluation.averagePercentage).toBe(72.5);
    expect(res.institutions.total).toBe(10);
    expect(res.approvals.pendingTotal).toBe(8);
    expect(res.approvals.byEntityType['QUESTION']).toBe(5);

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('admin:dashboard:'),
      expect.any(String),
      expect.any(Number),
    );
  });

  it('should return cached dashboard overview if available in Redis', async () => {
    const cachedPayload = {
      users: { total: 999 },
      timestamp: '2026-08-26T00:00:00Z',
    };
    redis.get.mockResolvedValue(JSON.stringify(cachedPayload));

    const res = await service.getDashboardOverview();

    expect(res.users.total).toBe(999);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});
