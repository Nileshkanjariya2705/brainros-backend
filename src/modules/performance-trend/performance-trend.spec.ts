import { Test, TestingModule } from '@nestjs/testing';
import { TrendAggregationService } from './services/trend-aggregation.service';
import { TrendDataProviderService } from './services/trend-data-provider.service';
import { MockComparisonService } from './services/mock-comparison.service';
import { StudentTrendService } from './services/student-trend.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const prismaMock = {
  attempt: {
    findMany: jest.fn(),
  },
  student: {
    findFirst: jest.fn().mockResolvedValue({ id: 'student-1' }),
  },
};

const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
};

describe('Mock Comparison & Performance Trend Engine', () => {
  let aggregationService: TrendAggregationService;
  let comparisonService: MockComparisonService;
  let trendService: StudentTrendService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendAggregationService,
        TrendDataProviderService,
        MockComparisonService,
        StudentTrendService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    aggregationService = module.get<TrendAggregationService>(
      TrendAggregationService,
    );
    comparisonService = module.get<MockComparisonService>(
      MockComparisonService,
    );
    trendService = module.get<StudentTrendService>(StudentTrendService);
    jest.clearAllMocks();
  });

  describe('TrendAggregationService', () => {
    const sampleAttempts = [
      {
        id: 'att-1',
        examId: 'ex-1',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        serverEndTime: new Date('2026-08-01T13:00:00Z'),
        exam: {
          title: 'NEET Mock 1',
          totalMarks: 720,
          examTarget: { name: 'NEET' },
        },
        result: {
          totalScore: 480,
          maxScore: 720,
          percentage: 66.67,
          accuracy: 72.5,
          timeUsedSeconds: 10250,
          subjectResults: [
            {
              subjectId: 'sub-1',
              subject: { name: 'Physics' },
              score: 100,
              maxScore: 180,
              accuracy: 60.0,
            },
            {
              subjectId: 'sub-2',
              subject: { name: 'Chemistry' },
              score: 120,
              maxScore: 180,
              accuracy: 70.0,
            },
          ],
        },
        candidateRanks: [
          { rank: 1240, totalCandidates: 12000, percentile: 89.67 },
        ],
        timeAnalyses: [
          {
            totalTimeUsedSeconds: 10250,
            timeUtilizationPercentage: 94.9,
            averageTimePerQuestionSeconds: 56.9,
          },
        ],
      },
      {
        id: 'att-2',
        examId: 'ex-2',
        createdAt: new Date('2026-08-05T10:00:00Z'),
        serverEndTime: new Date('2026-08-05T13:00:00Z'),
        exam: {
          title: 'NEET Mock 2',
          totalMarks: 720,
          examTarget: { name: 'NEET' },
        },
        result: {
          totalScore: 505,
          maxScore: 720,
          percentage: 70.14,
          accuracy: 75.8,
          timeUsedSeconds: 10100,
          subjectResults: [
            {
              subjectId: 'sub-1',
              subject: { name: 'Physics' },
              score: 115,
              maxScore: 180,
              accuracy: 68.0,
            },
            {
              subjectId: 'sub-2',
              subject: { name: 'Chemistry' },
              score: 125,
              maxScore: 180,
              accuracy: 72.0,
            },
          ],
        },
        candidateRanks: [
          { rank: 980, totalCandidates: 12500, percentile: 92.16 },
        ],
        timeAnalyses: [
          {
            totalTimeUsedSeconds: 10100,
            timeUtilizationPercentage: 93.5,
            averageTimePerQuestionSeconds: 56.1,
          },
        ],
      },
      {
        id: 'att-3',
        examId: 'ex-3',
        createdAt: new Date('2026-08-10T10:00:00Z'),
        serverEndTime: new Date('2026-08-10T13:00:00Z'),
        exam: {
          title: 'NEET Mock 3',
          totalMarks: 720,
          examTarget: { name: 'NEET' },
        },
        result: {
          totalScore: 530,
          maxScore: 720,
          percentage: 73.61,
          accuracy: 79.1,
          timeUsedSeconds: 9800,
          subjectResults: [
            {
              subjectId: 'sub-1',
              subject: { name: 'Physics' },
              score: 130,
              maxScore: 180,
              accuracy: 74.0,
            },
            {
              subjectId: 'sub-2',
              subject: { name: 'Chemistry' },
              score: 135,
              maxScore: 180,
              accuracy: 76.0,
            },
          ],
        },
        candidateRanks: [
          { rank: 650, totalCandidates: 13000, percentile: 95.0 },
        ],
        timeAnalyses: [
          {
            totalTimeUsedSeconds: 9800,
            timeUtilizationPercentage: 90.7,
            averageTimePerQuestionSeconds: 54.4,
          },
        ],
      },
      {
        id: 'att-4',
        examId: 'ex-4',
        createdAt: new Date('2026-08-15T10:00:00Z'),
        serverEndTime: new Date('2026-08-15T13:00:00Z'),
        exam: {
          title: 'NEET Mock 4',
          totalMarks: 720,
          examTarget: { name: 'NEET' },
        },
        result: {
          totalScore: 552,
          maxScore: 720,
          percentage: 76.67,
          accuracy: 81.3,
          timeUsedSeconds: 9600,
          subjectResults: [
            {
              subjectId: 'sub-1',
              subject: { name: 'Physics' },
              score: 140,
              maxScore: 180,
              accuracy: 78.4,
            },
            {
              subjectId: 'sub-2',
              subject: { name: 'Chemistry' },
              score: 140,
              maxScore: 180,
              accuracy: 79.0,
            },
          ],
        },
        candidateRanks: [
          { rank: 420, totalCandidates: 13500, percentile: 96.89 },
        ],
        timeAnalyses: [
          {
            totalTimeUsedSeconds: 9600,
            timeUtilizationPercentage: 88.8,
            averageTimePerQuestionSeconds: 53.3,
          },
        ],
      },
    ];

    it('aggregates chronological mock performance trends accurately', () => {
      const trends = aggregationService.aggregateTrends(sampleAttempts);

      expect(trends.summary.totalMocks).toBe(4);
      expect(trends.summary.scoreDelta).toBe(72);
      expect(trends.summary.percentageDelta).toBe(10);
      expect(trends.summary.accuracyDelta).toBe(8.8);
      expect(trends.summary.rankImprovement).toBe(820); // 1240 -> 420 (improved by 820 spots)
      expect(trends.summary.percentileDelta).toBe(7.22);
      expect(trends.summary.trendDirections.scoreTrend).toBe('IMPROVING');
      expect(trends.summary.trendDirections.accuracyTrend).toBe('IMPROVING');
      expect(trends.summary.trendDirections.rankTrend).toBe('IMPROVING');

      expect(trends.scoreTrend).toHaveLength(4);
      expect(trends.accuracyTrend).toHaveLength(4);
      expect(trends.rankTrend).toHaveLength(4);
      expect(trends.timeTrend).toHaveLength(4);
      expect(trends.subjectTrends).toHaveLength(2);

      // Best and worst mocks
      expect(trends.summary.bestMock?.attemptId).toBe('att-4');
      expect(trends.summary.worstMock?.attemptId).toBe('att-1');

      // Most improved subject (Physics 60.0% -> 78.4% = +18.4%)
      expect(trends.summary.mostImprovedSubject?.subjectName).toBe('Physics');
      expect(trends.summary.mostImprovedSubject?.accuracyDelta).toBe(18.4);
    });

    it('handles empty mock history gracefully', () => {
      const trends = aggregationService.aggregateTrends([]);
      expect(trends.summary.totalMocks).toBe(0);
      expect(trends.mocks).toEqual([]);
      expect(trends.summary.trendDirections.scoreTrend).toBe(
        'INSUFFICIENT_DATA',
      );
    });

    it('handles partial metric availability without failing', () => {
      const partialAttempt = [
        {
          id: 'att-partial',
          examId: 'ex-1',
          createdAt: new Date(),
          exam: { title: 'Mock Partial', totalMarks: 720 },
          result: {
            totalScore: 500,
            maxScore: 720,
            percentage: 69.4,
            accuracy: 75.0,
          },
          candidateRanks: [], // rank pending
          timeAnalyses: [], // time analysis not available
        },
      ];

      const trends = aggregationService.aggregateTrends(partialAttempt);
      expect(trends.summary.totalMocks).toBe(1);
      expect(trends.mocks[0].score).toBe(500);
      expect(trends.mocks[0].rank).toBeNull();
      expect(trends.mocks[0].timeUsedSeconds).toBeNull();
    });
  });

  describe('MockComparisonService', () => {
    it('compares two attempts side-by-side with subject deltas', async () => {
      const mockAttempts = [
        {
          id: 'att-1',
          studentId: 'st-1',
          createdAt: new Date(),
          examId: 'ex-1',
          exam: {
            title: 'Mock 1',
            totalMarks: 720,
            examTarget: { name: 'NEET' },
          },
          result: {
            totalScore: 480,
            maxScore: 720,
            percentage: 66.67,
            accuracy: 72.5,
            subjectResults: [
              {
                subjectId: 'sub-1',
                subject: { name: 'Physics' },
                score: 100,
                accuracy: 60.0,
              },
            ],
          },
          candidateRanks: [
            { rank: 1240, percentile: 89.67, totalCandidates: 12000 },
          ],
          timeAnalyses: [{ totalTimeUsedSeconds: 10250 }],
        },
        {
          id: 'att-2',
          studentId: 'st-1',
          createdAt: new Date(),
          examId: 'ex-2',
          exam: {
            title: 'Mock 2',
            totalMarks: 720,
            examTarget: { name: 'NEET' },
          },
          result: {
            totalScore: 552,
            maxScore: 720,
            percentage: 76.67,
            accuracy: 81.3,
            subjectResults: [
              {
                subjectId: 'sub-1',
                subject: { name: 'Physics' },
                score: 140,
                accuracy: 78.4,
              },
            ],
          },
          candidateRanks: [
            { rank: 420, percentile: 96.89, totalCandidates: 13500 },
          ],
          timeAnalyses: [{ totalTimeUsedSeconds: 9600 }],
        },
      ];

      prismaMock.attempt.findMany.mockResolvedValue(mockAttempts);

      const comparison = await comparisonService.compareMocks(
        'att-1',
        'att-2',
        'st-1',
      );

      expect(comparison.scoreDelta).toBe(72);
      expect(comparison.accuracyDelta).toBe(8.8);
      expect(comparison.rankImprovement).toBe(820);
      expect(comparison.subjectDeltas).toHaveLength(1);
      expect(comparison.subjectDeltas[0].accuracyDelta).toBe(18.4);
      expect(comparison.subjectDeltas[0].scoreDelta).toBe(40);
    });
  });
});
