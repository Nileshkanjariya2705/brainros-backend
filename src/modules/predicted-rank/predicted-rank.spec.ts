import { Test, TestingModule } from '@nestjs/testing';
import { HistoricalInterpolationModel } from './services/historical-interpolation.model';
import { HistoricalDatasetService } from './services/historical-dataset.service';
import { HistoricalDatasetSelectorService } from './services/historical-dataset-selector.service';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { PredictionEvaluationService } from './services/prediction-evaluation.service';
import { PredictionQueryService } from './services/prediction-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SelectedHistoricalDataset } from './interfaces/predicted-rank.interface';

const prismaMock = {
  historicalExam: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  historicalScoreRange: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  attempt: {
    findUnique: jest.fn(),
  },
  candidateRank: {
    findMany: jest.fn(),
  },
  predictionResult: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  predictionEvaluation: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn((cb) => cb(prismaMock)),
};

const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

describe('Predicted Rank Engine', () => {
  let interpolationModel: HistoricalInterpolationModel;
  let datasetService: HistoricalDatasetService;
  let generatorService: PredictionGeneratorService;
  let evaluationService: PredictionEvaluationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoricalInterpolationModel,
        HistoricalDatasetService,
        HistoricalDatasetSelectorService,
        PredictionGeneratorService,
        PredictionEvaluationService,
        PredictionQueryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    interpolationModel = module.get<HistoricalInterpolationModel>(
      HistoricalInterpolationModel,
    );
    datasetService = module.get<HistoricalDatasetService>(
      HistoricalDatasetService,
    );
    generatorService = module.get<PredictionGeneratorService>(
      PredictionGeneratorService,
    );
    evaluationService = module.get<PredictionEvaluationService>(
      PredictionEvaluationService,
    );
    jest.clearAllMocks();
  });

  describe('HistoricalInterpolationModel', () => {
    const sampleDatasets: SelectedHistoricalDataset[] = [
      {
        historicalExamId: 'hexam-1',
        examName: 'NEET 2025 Mock A',
        examType: 'NEET',
        totalMarks: 720,
        totalCandidates: 10000,
        weight: 1.0,
        scoreRanges: [
          {
            minScore: 600,
            maxScore: 609,
            representativeScore: 605,
            minRank: 351,
            maxRank: 500,
            candidateCount: 150,
          },
          {
            minScore: 610,
            maxScore: 619,
            representativeScore: 615,
            minRank: 221,
            maxRank: 350,
            candidateCount: 130,
          },
          {
            minScore: 620,
            maxScore: 629,
            representativeScore: 625,
            minRank: 121,
            maxRank: 220,
            candidateCount: 100,
          },
          {
            minScore: 630,
            maxScore: 720,
            representativeScore: 675,
            minRank: 1,
            maxRank: 120,
            candidateCount: 120,
          },
        ],
      },
    ];

    it('interpolates score accurately between score brackets (615 -> rank in 221-350 bracket)', () => {
      const output = interpolationModel.predict(
        {
          attemptId: 'att-1',
          studentId: 'st-1',
          score: 615,
          totalMarks: 720,
          examType: 'NEET',
        },
        sampleDatasets,
      );

      expect(output.status).toBe('COMPLETED');
      expect(output.predictedRank).toBeGreaterThanOrEqual(220);
      expect(output.predictedRank).toBeLessThanOrEqual(350);
      expect(output.predictedRankMin).toBeLessThanOrEqual(
        output.predictedRank!,
      );
      expect(output.predictedRankMax).toBeGreaterThanOrEqual(
        output.predictedRank!,
      );
      expect(output.confidence).toBeDefined();
    });

    it('maps top score to Rank 1', () => {
      const output = interpolationModel.predict(
        {
          attemptId: 'att-1',
          studentId: 'st-1',
          score: 720,
          totalMarks: 720,
          examType: 'NEET',
        },
        sampleDatasets,
      );

      expect(output.status).toBe('COMPLETED');
      expect(output.predictedRank).toBe(1);
    });

    it('returns UNAVAILABLE when 0 historical datasets are provided', () => {
      const output = interpolationModel.predict(
        {
          attemptId: 'att-1',
          studentId: 'st-1',
          score: 600,
          totalMarks: 720,
          examType: 'NEET',
        },
        [],
      );

      expect(output.status).toBe('UNAVAILABLE');
      expect(output.unavailableReason).toBe('INSUFFICIENT_HISTORICAL_DATA');
    });

    it('combines multiple datasets with weighted averaging', () => {
      const multiDatasets: SelectedHistoricalDataset[] = [
        {
          historicalExamId: 'h1',
          examName: 'Exam 1',
          examType: 'JEE',
          totalMarks: 300,
          totalCandidates: 5000,
          weight: 0.6,
          scoreRanges: [
            {
              minScore: 200,
              maxScore: 300,
              representativeScore: 250,
              minRank: 1,
              maxRank: 100,
              candidateCount: 100,
            },
          ],
        },
        {
          historicalExamId: 'h2',
          examName: 'Exam 2',
          examType: 'JEE',
          totalMarks: 300,
          totalCandidates: 5000,
          weight: 0.4,
          scoreRanges: [
            {
              minScore: 200,
              maxScore: 300,
              representativeScore: 250,
              minRank: 1,
              maxRank: 120,
              candidateCount: 120,
            },
          ],
        },
      ];

      const output = interpolationModel.predict(
        {
          attemptId: 'att-1',
          studentId: 'st-1',
          score: 250,
          totalMarks: 300,
          examType: 'JEE',
        },
        multiDatasets,
      );

      expect(output.status).toBe('COMPLETED');
      expect(output.historicalExamCount).toBe(2);
      expect(output.predictedRank).toBeDefined();
    });
  });

  describe('HistoricalDatasetService Quality Validation', () => {
    it('validates monotonic score-to-rank dataset as VALID', async () => {
      const mockExam = {
        id: 'hexam-1',
        totalMarks: 720,
        totalCandidates: 10000,
        scoreRanges: [
          {
            minScore: 500,
            maxScore: 599,
            representativeScore: 550,
            minRank: 500,
            maxRank: 1000,
            candidateCount: 500,
          },
          {
            minScore: 600,
            maxScore: 699,
            representativeScore: 650,
            minRank: 100,
            maxRank: 499,
            candidateCount: 400,
          },
          {
            minScore: 700,
            maxScore: 720,
            representativeScore: 710,
            minRank: 1,
            maxRank: 99,
            candidateCount: 99,
          },
        ],
      };

      prismaMock.historicalExam.findUnique.mockResolvedValue(mockExam);
      prismaMock.historicalExam.update.mockResolvedValue({
        ...mockExam,
        dataQualityStatus: 'VALID',
      });

      const report = await datasetService.validateDataset('hexam-1');
      expect(report.status).toBe('VALID');
      expect(report.isMonotonic).toBe(true);
      expect(report.qualityScore).toBeGreaterThanOrEqual(80);
    });

    it('flags inverted score-to-rank dataset as INVALID', async () => {
      const mockInvertedExam = {
        id: 'hexam-2',
        totalMarks: 720,
        totalCandidates: 10000,
        scoreRanges: [
          // Lower score 500 has BETTER rank (1-100) than higher score 700 (500-1000) -> inverted!
          {
            minScore: 500,
            maxScore: 599,
            representativeScore: 550,
            minRank: 1,
            maxRank: 100,
            candidateCount: 100,
          },
          {
            minScore: 700,
            maxScore: 720,
            representativeScore: 710,
            minRank: 500,
            maxRank: 1000,
            candidateCount: 500,
          },
        ],
      };

      prismaMock.historicalExam.findUnique.mockResolvedValue(mockInvertedExam);
      prismaMock.historicalExam.update.mockResolvedValue({
        ...mockInvertedExam,
        dataQualityStatus: 'INVALID',
      });

      const report = await datasetService.validateDataset('hexam-2');
      expect(report.isMonotonic).toBe(false);
      expect(report.status).toBe('INVALID');
    });
  });

  describe('PredictionEvaluationService', () => {
    it('computes model accuracy summary metrics', async () => {
      prismaMock.predictionEvaluation.findMany.mockResolvedValue([
        { absoluteError: 10, relativeError: 3.5, withinPredictedRange: true },
        { absoluteError: 15, relativeError: 5.0, withinPredictedRange: true },
        { absoluteError: 20, relativeError: 7.0, withinPredictedRange: false },
      ]);

      const summary = await evaluationService.getModelAccuracySummary('v1.0.0');
      expect(summary.totalEvaluations).toBe(3);
      expect(summary.meanAbsoluteError).toBe(15.0);
      expect(summary.medianAbsoluteError).toBe(15.0);
      expect(summary.rangeCoveragePercentage).toBe(66.67);
    });
  });
});
