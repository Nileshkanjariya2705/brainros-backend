import { Test, TestingModule } from '@nestjs/testing';
import { ResultReconciliationProcessor } from './result-reconciliation.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ResultService } from '../result.service';
import { ResultReadinessService } from '../services/result-readiness.service';
import { ResultAccessService } from '../services/result-access.service';
import { getQueueToken } from '@nestjs/bullmq';
import {
  EVALUATION_QUEUE_NAME,
  EXAM_WINDOW_END_QUEUE_NAME,
  ResultStatusEnum,
} from '../interfaces/result-lifecycle.interface';

describe('ResultReconciliationProcessor (Background Recovery & Reconciliation)', () => {
  let processor: ResultReconciliationProcessor;

  const mockPrisma = {
    result: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    attempt: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    exam: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    attemptStatus: {
      findUnique: jest.fn().mockResolvedValue({ id: 'status-auto' }),
    },
  };

  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };

  const mockResultService = {
    calculateResult: jest.fn(),
  };

  const mockReadinessService = {
    isLiveExam: jest.fn(),
  };

  const mockResultAccessService = {
    invalidateResultCache: jest.fn().mockResolvedValue(undefined),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultReconciliationProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: ResultService, useValue: mockResultService },
        { provide: ResultReadinessService, useValue: mockReadinessService },
        { provide: ResultAccessService, useValue: mockResultAccessService },
        { provide: getQueueToken(EVALUATION_QUEUE_NAME), useValue: mockQueue },
        { provide: getQueueToken(EXAM_WINDOW_END_QUEUE_NAME), useValue: mockQueue },
      ],
    }).compile();

    processor = module.get<ResultReconciliationProcessor>(ResultReconciliationProcessor);
    jest.clearAllMocks();
  });

  it('reconciles stuck Mock calculated results by marking them PUBLISHED', async () => {
    mockReadinessService.isLiveExam.mockResolvedValue(false); // Mock
    mockPrisma.result.findMany.mockResolvedValue([
      {
        id: 'res-stuck-1',
        attemptId: 'att-stuck-1',
        resultStatus: ResultStatusEnum.EVALUATED,
        publishedAt: null,
        attempt: {
          examId: 'exam-mock-1',
          studentId: 'stu-1',
          timeAnalyses: [],
          strategyAnalyses: [],
        },
      },
    ]);
    mockPrisma.attempt.findMany.mockResolvedValue([]);

    const jobMock = { data: {} } as any;
    const result = await processor.process(jobMock);

    expect(result.stats.repairedMockPublished).toBe(1);
    expect(mockPrisma.result.update).toHaveBeenCalledWith({
      where: { id: 'res-stuck-1' },
      data: expect.objectContaining({
        resultStatus: ResultStatusEnum.PUBLISHED,
      }),
    });
    expect(mockResultAccessService.invalidateResultCache).toHaveBeenCalledWith(
      'att-stuck-1',
      'stu-1',
      'exam-mock-1',
    );
  });

  it('recovers stuck submitted attempts with no result by calculating them', async () => {
    mockPrisma.result.findMany.mockResolvedValue([]);
    mockPrisma.attempt.findMany.mockResolvedValue([
      { id: 'att-missing-res-1', examId: 'exam-1', studentId: 'stu-1' },
    ]);
    mockResultService.calculateResult.mockResolvedValue({ id: 'res-new' });

    const jobMock = { data: {} } as any;
    const result = await processor.process(jobMock);

    expect(result.stats.requeuedMissingResults).toBe(1);
    expect(mockResultService.calculateResult).toHaveBeenCalledWith('att-missing-res-1');
  });

  it('skips run if distributed lock is already active to prevent duplicate execution', async () => {
    mockRedis.get.mockResolvedValue('locked');

    const jobMock = { data: {} } as any;
    const result = await processor.process(jobMock);

    expect(result.skipped).toBe(true);
    expect(mockPrisma.result.findMany).not.toHaveBeenCalled();
  });
});
