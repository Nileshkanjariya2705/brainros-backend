import { Test, TestingModule } from '@nestjs/testing';
import { TieBreakService } from './services/tie-break.service';
import { PercentileService } from './services/percentile.service';
import { PredictionService } from './services/prediction.service';
import { RankGenerationService } from './services/rank-generation.service';
import { RankQueryService } from './services/rank-query.service';
import { RankingCandidateEligibilityService } from './services/ranking-candidate-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CandidateRankInput } from './interfaces/rank-engine.interface';

const prismaMock = {
  exam: { findUnique: jest.fn() },
  rankSnapshot: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  candidateRank: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  attempt: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(prismaMock)),
};

const redisMock = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
};

describe('Rank & Percentile Engine', () => {
  let tieBreakService: TieBreakService;
  let percentileService: PercentileService;
  let predictionService: PredictionService;
  let rankGenerationService: RankGenerationService;
  let rankQueryService: RankQueryService;
  let eligibilityService: RankingCandidateEligibilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TieBreakService,
        PercentileService,
        PredictionService,
        RankGenerationService,
        RankQueryService,
        RankingCandidateEligibilityService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    tieBreakService = module.get<TieBreakService>(TieBreakService);
    percentileService = module.get<PercentileService>(PercentileService);
    predictionService = module.get<PredictionService>(PredictionService);
    rankGenerationService = module.get<RankGenerationService>(RankGenerationService);
    rankQueryService = module.get<RankQueryService>(RankQueryService);
    eligibilityService = module.get<RankingCandidateEligibilityService>(RankingCandidateEligibilityService);
    jest.clearAllMocks();
  });

  describe('TieBreakService', () => {
    it('ranks distinct scores in descending order (1, 2, 3)', () => {
      const candidates: CandidateRankInput[] = [
        { attemptId: 'a3', studentId: 's3', studentName: 'Charlie', studentCode: 'S3', score: 650, maxScore: 720, percentage: 90.28, accuracy: 90, correctCount: 165, wrongCount: 15, unattemptedCount: 0, negativeMarksLost: 15, timeUsedSeconds: 3000 },
        { attemptId: 'a1', studentId: 's1', studentName: 'Alice', studentCode: 'S1', score: 720, maxScore: 720, percentage: 100, accuracy: 100, correctCount: 180, wrongCount: 0, unattemptedCount: 0, negativeMarksLost: 0, timeUsedSeconds: 2800 },
        { attemptId: 'a2', studentId: 's2', studentName: 'Bob', studentCode: 'S2', score: 700, maxScore: 720, percentage: 97.22, accuracy: 95, correctCount: 176, wrongCount: 4, unattemptedCount: 0, negativeMarksLost: 4, timeUsedSeconds: 2900 },
      ];

      const sorted = tieBreakService.sortCandidates(candidates);
      const ranked = tieBreakService.assignRanks(sorted, 'COMPETITION');

      expect(ranked[0].candidate.studentId).toBe('s1');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].candidate.studentId).toBe('s2');
      expect(ranked[1].rank).toBe(2);
      expect(ranked[2].candidate.studentId).toBe('s3');
      expect(ranked[2].rank).toBe(3);
    });

    it('assigns competition rank ties (1, 1, 3)', () => {
      const tiedCandidates: CandidateRankInput[] = [
        { attemptId: 'a1', studentId: 's1', studentName: 'Alice', studentCode: 'S1', score: 720, maxScore: 720, percentage: 100, accuracy: 100, correctCount: 180, wrongCount: 0, unattemptedCount: 0, negativeMarksLost: 0, timeUsedSeconds: 2800 },
        { attemptId: 'a2', studentId: 's2', studentName: 'Bob', studentCode: 'S2', score: 720, maxScore: 720, percentage: 100, accuracy: 100, correctCount: 180, wrongCount: 0, unattemptedCount: 0, negativeMarksLost: 0, timeUsedSeconds: 2800 },
        { attemptId: 'a3', studentId: 's3', studentName: 'Charlie', studentCode: 'S3', score: 700, maxScore: 720, percentage: 97.22, accuracy: 95, correctCount: 176, wrongCount: 4, unattemptedCount: 0, negativeMarksLost: 4, timeUsedSeconds: 2900 },
      ];

      const sorted = tieBreakService.sortCandidates(tiedCandidates);
      const ranked = tieBreakService.assignRanks(sorted, 'COMPETITION');

      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(1);
      expect(ranked[2].rank).toBe(3); // Next rank is 3!
    });

    it('breaks ties using accuracy, negative marks, and completion time', () => {
      const candidates: CandidateRankInput[] = [
        // Candidate A: same score (500), but higher accuracy (90% vs 80%)
        { attemptId: 'a1', studentId: 's1', studentName: 'A', studentCode: 'S1', score: 500, maxScore: 720, percentage: 69.4, accuracy: 90, correctCount: 130, wrongCount: 20, unattemptedCount: 30, negativeMarksLost: 20, timeUsedSeconds: 3000 },
        // Candidate B: same score (500), lower accuracy (80%)
        { attemptId: 'a2', studentId: 's2', studentName: 'B', studentCode: 'S2', score: 500, maxScore: 720, percentage: 69.4, accuracy: 80, correctCount: 140, wrongCount: 60, unattemptedCount: 0, negativeMarksLost: 60, timeUsedSeconds: 3200 },
      ];

      const sorted = tieBreakService.sortCandidates(candidates);
      expect(sorted[0].studentId).toBe('s1');
      expect(sorted[1].studentId).toBe('s2');
    });
  });

  describe('PercentileService', () => {
    it('calculates exact percentiles with bounds', () => {
      expect(percentileService.calculatePercentile(1, 100)).toBe(100.0);
      expect(percentileService.calculatePercentile(50, 100)).toBe(51.0);
      expect(percentileService.calculatePercentile(100, 100)).toBe(1.0);
      expect(percentileService.calculatePercentile(1, 1)).toBe(100.0);
      expect(percentileService.calculatePercentile(0, 0)).toBe(0);
    });
  });

  describe('PredictionService', () => {
    it('provides statistical predicted rank range with confidence', () => {
      const pred = predictionService.predictRankRange({
        actualRank: 10,
        totalCandidates: 1000,
        score: 680,
        maxScore: 720,
        percentile: 99.1,
      });

      expect(pred.min).toBeLessThanOrEqual(10);
      expect(pred.max).toBeGreaterThanOrEqual(10);
      expect(pred.confidence).toBe('HIGH');
      expect(pred.modelVersion).toBe('v1.0.0');
    });
  });

  describe('RankGenerationService & Partitioning', () => {
    it('generates overall and scoped ranks (State, District, School, Category)', async () => {
      const examId = 'exam-101';
      const mockExam = { id: examId, title: 'JEE Main Full Mock', totalMarks: 300 };

      const mockCandidates: CandidateRankInput[] = [
        {
          attemptId: 'att-1',
          studentId: 'st-1',
          studentName: 'Alice',
          studentCode: 'ST1',
          score: 290,
          maxScore: 300,
          percentage: 96.67,
          accuracy: 98,
          correctCount: 73,
          wrongCount: 2,
          unattemptedCount: 0,
          negativeMarksLost: 2,
          timeUsedSeconds: 3200,
          state: 'Gujarat',
          district: 'Ahmedabad',
          schoolCollege: 'DPS Ahmedabad',
          category: 'GENERAL',
        },
        {
          attemptId: 'att-2',
          studentId: 'st-2',
          studentName: 'Bob',
          studentCode: 'ST2',
          score: 280,
          maxScore: 300,
          percentage: 93.33,
          accuracy: 95,
          correctCount: 71,
          wrongCount: 4,
          unattemptedCount: 0,
          negativeMarksLost: 4,
          timeUsedSeconds: 3300,
          state: 'Gujarat',
          district: 'Surat',
          schoolCollege: 'Navrachana Surat',
          category: 'OBC',
        },
        {
          attemptId: 'att-3',
          studentId: 'st-3',
          studentName: 'Charlie',
          studentCode: 'ST3',
          score: 270,
          maxScore: 300,
          percentage: 90.0,
          accuracy: 92,
          correctCount: 69,
          wrongCount: 6,
          unattemptedCount: 0,
          negativeMarksLost: 6,
          timeUsedSeconds: 3400,
          state: 'Maharashtra',
          district: 'Mumbai',
          schoolCollege: 'DPS Mumbai',
          category: 'GENERAL',
        },
      ];

      prismaMock.exam.findUnique.mockResolvedValue(mockExam);
      prismaMock.rankSnapshot.findUnique.mockResolvedValue(null);
      prismaMock.rankSnapshot.upsert.mockResolvedValue({ id: 'snap-1', snapshotVersion: 1 });
      jest.spyOn(eligibilityService, 'getEligibleCandidates').mockResolvedValue(mockCandidates);

      const result = await rankGenerationService.generateRanks({ examId, snapshotVersion: 1 });

      expect(result.status).toBe('COMPLETED');
      expect(result.totalCandidates).toBe(3);
      expect(result.highestScore).toBe(290);
      expect(result.lowestScore).toBe(270);
      expect(result.averageScore).toBe(280);

      // Verify transaction was called and inserted candidate ranks
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.candidateRank.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ studentId: 'st-1', rankType: 'OVERALL', rank: 1 }),
            expect.objectContaining({ studentId: 'st-1', rankType: 'STATE', scopeName: 'Gujarat', rank: 1 }),
            expect.objectContaining({ studentId: 'st-1', rankType: 'DISTRICT', scopeName: 'Ahmedabad', rank: 1 }),
            expect.objectContaining({ studentId: 'st-1', rankType: 'SCHOOL', scopeName: 'DPS Ahmedabad', rank: 1 }),
          ]),
        }),
      );
    });
  });

  describe('RankQueryService', () => {
    it('returns indexed rank summary for student result page', async () => {
      const attemptId = 'att-1';
      const studentId = 'st-1';
      const examId = 'exam-101';

      prismaMock.attempt.findUnique.mockResolvedValue({
        id: attemptId,
        studentId,
        examId,
        exam: { id: examId, title: 'JEE Main Full Mock' },
      });

      prismaMock.rankSnapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        snapshotVersion: 1,
        status: 'COMPLETED',
        totalCandidates: 1000,
        completedAt: new Date(),
      });

      prismaMock.candidateRank.findMany.mockResolvedValue([
        { rankType: 'OVERALL', rank: 12, totalCandidates: 1000, percentile: 98.9, score: 280, accuracy: 95, predictedRankMin: 10, predictedRankMax: 15, predictionConfidence: 'HIGH' },
        { rankType: 'STATE', scopeName: 'Gujarat', rank: 2, totalCandidates: 250, percentile: 99.6, score: 280, accuracy: 95 },
        { rankType: 'DISTRICT', scopeName: 'Ahmedabad', rank: 1, totalCandidates: 80, percentile: 100.0, score: 280, accuracy: 95 },
      ]);

      const res = await rankQueryService.getMyRanks(attemptId, studentId);

      expect(res.status).toBe('RANK_READY');
      expect(res.overall.rank).toBe(12);
      expect(res.overall.percentile).toBe(98.9);
      expect(res.state?.rank).toBe(2);
      expect(res.state?.scopeName).toBe('Gujarat');
      expect(res.district?.rank).toBe(1);
      expect(res.predictedRank?.predictedRankMin).toBe(10);
    });
  });
});
