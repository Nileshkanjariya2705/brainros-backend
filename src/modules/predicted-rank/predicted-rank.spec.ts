import { Test, TestingModule } from '@nestjs/testing';
import { HistoricalInterpolationModel } from './services/historical-interpolation.model';
import { HistoricalDatasetService } from './services/historical-dataset.service';
import { HistoricalDatasetSelectorService } from './services/historical-dataset-selector.service';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { PredictionEvaluationService } from './services/prediction-evaluation.service';
import { PredictionQueryService } from './services/prediction-query.service';
import { StudentTargetPredictionService } from './services/student-target-prediction.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SelectedHistoricalDataset } from './interfaces/predicted-rank.interface';

const prismaMock = {
  student: {
    findFirst: jest.fn(),
  },
  historicalExam: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  historicalScoreRange: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    create: jest.fn(),
  },
  attempt: {
    findMany: jest.fn(),
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
  let studentTargetPredictionService: StudentTargetPredictionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoricalInterpolationModel,
        HistoricalDatasetService,
        HistoricalDatasetSelectorService,
        PredictionGeneratorService,
        PredictionEvaluationService,
        PredictionQueryService,
        StudentTargetPredictionService,
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
    studentTargetPredictionService = module.get<StudentTargetPredictionService>(
      StudentTargetPredictionService,
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

  describe('StudentTargetPredictionService (10 Core Scenarios)', () => {
    const mockNEETHistorical = [
      {
        id: 'neet-2024',
        examName: 'NEET UG 2024 (Official All India)',
        examType: 'NEET',
        totalMarks: 720,
        totalCandidates: 2000000,
        scoreRanges: [
          { minScore: 700, maxScore: 720, minRank: 1, maxRank: 100, representativeScore: 710 },
          { minScore: 650, maxScore: 699, minRank: 101, maxRank: 4500, representativeScore: 675 },
          { minScore: 600, maxScore: 649, minRank: 4501, maxRank: 20000, representativeScore: 625 },
          { minScore: 500, maxScore: 599, minRank: 20001, maxRank: 85000, representativeScore: 550 },
          { minScore: 400, maxScore: 499, minRank: 85001, maxRank: 220000, representativeScore: 450 },
          { minScore: 100, maxScore: 399, minRank: 220001, maxRank: 1000000, representativeScore: 250 },
        ],
      },
    ];

    const mockJEEHistorical = [
      {
        id: 'jee-2024',
        examName: 'JEE Main 2024 Session 2 (Official All India)',
        examType: 'JEE_MAIN',
        totalMarks: 300,
        totalCandidates: 1200000,
        scoreRanges: [
          { minScore: 270, maxScore: 300, minRank: 1, maxRank: 800, representativeScore: 285 },
          { minScore: 240, maxScore: 269, minRank: 801, maxRank: 3500, representativeScore: 255 },
          { minScore: 200, maxScore: 239, minRank: 3501, maxRank: 12000, representativeScore: 220 },
          { minScore: 160, maxScore: 199, minRank: 12001, maxRank: 32000, representativeScore: 180 },
          { minScore: 120, maxScore: 159, minRank: 32001, maxRank: 70000, representativeScore: 140 },
          { minScore: 50, maxScore: 119, minRank: 70001, maxRank: 300000, representativeScore: 85 },
        ],
      },
    ];

    // TEST CASE 1: No previous attempt -> INSUFFICIENT_DATA
    it('Scenario 1: returns INSUFFICIENT_DATA when student has 0 completed attempts', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        examTarget: { name: 'JEE' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([]);

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-1');

      expect(result.available).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_DATA');
      expect(result.targetExam).toBe('JEE');
    });

    // TEST CASE 2: One attempt -> prediction generated with LOW confidence
    it('Scenario 2: generates prediction with LOW confidence for a single attempt', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-2',
        examTarget: { name: 'NEET' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-01-10'),
          result: { totalScore: 615, maxScore: 720, percentage: 85.42, accuracy: 88.0 },
          exam: { totalMarks: 720, examTarget: { name: 'NEET' } },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockNEETHistorical);

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-2');

      expect(result.available).toBe(true);
      expect(result.targetExam).toBe('NEET');
      expect(result.predictedRank).toBeGreaterThan(0);
      expect(result.confidence).toBe('LOW');
      expect(result.attemptsUsed).toBe(1);
    });

    // TEST CASE 3: Multiple consistent attempts -> stable prediction & higher confidence
    it('Scenario 3: provides higher confidence and stable prediction for multiple consistent attempts', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-3',
        examTarget: { name: 'JEE' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-03-01'),
          result: { totalScore: 240, maxScore: 300, percentage: 80.0, accuracy: 85.0 },
        },
        {
          id: 'att-2',
          examId: 'exam-2',
          createdAt: new Date('2026-02-15'),
          result: { totalScore: 243, maxScore: 300, percentage: 81.0, accuracy: 86.0 },
        },
        {
          id: 'att-3',
          examId: 'exam-3',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 246, maxScore: 300, percentage: 82.0, accuracy: 87.0 },
        },
        {
          id: 'att-4',
          examId: 'exam-4',
          createdAt: new Date('2026-01-15'),
          result: { totalScore: 249, maxScore: 300, percentage: 83.0, accuracy: 88.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockJEEHistorical);

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-3');

      expect(result.available).toBe(true);
      expect(result.targetExam).toBe('JEE');
      expect(result.confidence).toBe('HIGH');
      expect(result.rankRange?.min).toBeLessThanOrEqual(result.predictedRank!);
      expect(result.rankRange?.max).toBeGreaterThanOrEqual(result.predictedRank!);
    });

    // TEST CASE 4: Improving student -> reflects recent improved performance & trend: IMPROVING
    it('Scenario 4: reflects recent improved performance with IMPROVING trend', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-4',
        examTarget: { name: 'JEE' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-03-01'),
          result: { totalScore: 252, maxScore: 300, percentage: 84.0, accuracy: 90.0 }, // latest
        },
        {
          id: 'att-2',
          examId: 'exam-2',
          createdAt: new Date('2026-02-15'),
          result: { totalScore: 234, maxScore: 300, percentage: 78.0, accuracy: 82.0 },
        },
        {
          id: 'att-3',
          examId: 'exam-3',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 216, maxScore: 300, percentage: 72.0, accuracy: 76.0 },
        },
        {
          id: 'att-4',
          examId: 'exam-4',
          createdAt: new Date('2026-01-15'),
          result: { totalScore: 195, maxScore: 300, percentage: 65.0, accuracy: 70.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockJEEHistorical);

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-4');

      expect(result.available).toBe(true);
      expect(result.trend).toBe('IMPROVING');
      // Recency weighting gives higher score than simple average ((84+78+72+65)/4 = 74.75)
      expect(result.normalizedPercentage).toBeGreaterThan(75);
    });

    // TEST CASE 5: Declining student -> reflects recent decline & trend: DECLINING
    it('Scenario 5: reflects recent performance decline with DECLINING trend', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-5',
        examTarget: { name: 'JEE' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-03-01'),
          result: { totalScore: 195, maxScore: 300, percentage: 65.0, accuracy: 70.0 }, // latest declined
        },
        {
          id: 'att-2',
          examId: 'exam-2',
          createdAt: new Date('2026-02-15'),
          result: { totalScore: 216, maxScore: 300, percentage: 72.0, accuracy: 76.0 },
        },
        {
          id: 'att-3',
          examId: 'exam-3',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 234, maxScore: 300, percentage: 78.0, accuracy: 82.0 },
        },
        {
          id: 'att-4',
          examId: 'exam-4',
          createdAt: new Date('2026-01-15'),
          result: { totalScore: 252, maxScore: 300, percentage: 84.0, accuracy: 90.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockJEEHistorical);

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-5');

      expect(result.available).toBe(true);
      expect(result.trend).toBe('DECLINING');
      expect(result.normalizedPercentage).toBeLessThan(75);
    });

    // TEST CASE 6: Target Exam Isolation -> JEE vs NEET produce different predicted ranks for same 80%
    it('Scenario 6: isolates target exams so JEE and NEET datasets produce target-appropriate ranks', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce({
        id: 'student-jee',
        examTarget: { name: 'JEE' },
      });
      prismaMock.attempt.findMany.mockResolvedValueOnce([
        {
          id: 'att-jee',
          examId: 'exam-jee',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 240, maxScore: 300, percentage: 80.0, accuracy: 85.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValueOnce(mockJEEHistorical);

      const resultJEE = await studentTargetPredictionService.getStudentTargetPrediction('student-jee');

      prismaMock.student.findFirst.mockResolvedValueOnce({
        id: 'student-neet',
        examTarget: { name: 'NEET' },
      });
      prismaMock.attempt.findMany.mockResolvedValueOnce([
        {
          id: 'att-neet',
          examId: 'exam-neet',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 576, maxScore: 720, percentage: 80.0, accuracy: 85.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValueOnce(mockNEETHistorical);

      const resultNEET = await studentTargetPredictionService.getStudentTargetPrediction('student-neet');

      expect(resultJEE.available).toBe(true);
      expect(resultNEET.available).toBe(true);
      expect(resultJEE.targetExam).toBe('JEE');
      expect(resultNEET.targetExam).toBe('NEET');
      // Due to different candidate pools and score distributions, predicted ranks must differ
      expect(resultJEE.predictedRank).not.toEqual(resultNEET.predictedRank);
    });

    // TEST CASE 7: No Historical Dataset -> PREDICTION_UNAVAILABLE
    it('Scenario 7: returns PREDICTION_UNAVAILABLE when no historical dataset exists for target', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-cet',
        examTarget: { name: 'CET' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 160, maxScore: 200, percentage: 80.0, accuracy: 85.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValue([]); // No CET datasets in DB

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-cet');

      expect(result.available).toBe(false);
      expect(result.reason).toBe('PREDICTION_UNAVAILABLE');
    });

    // TEST CASE 8: Out of Range score handled safely without breaking
    it('Scenario 8: handles out-of-range top and bottom scores safely', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-top',
        examTarget: { name: 'NEET' },
      });
      prismaMock.attempt.findMany.mockResolvedValue([
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 720, maxScore: 720, percentage: 100.0, accuracy: 100.0 },
        },
      ]);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockNEETHistorical);

      const resultTop = await studentTargetPredictionService.getStudentTargetPrediction('student-top');

      expect(resultTop.available).toBe(true);
      expect(resultTop.predictedRank).toBe(1);
      expect(resultTop.rankRange?.min).toBe(1);
    });

    // TEST CASE 9: Same performance produces identical deterministic prediction
    it('Scenario 9: deterministic stability: identical performance inputs yield identical predictions', async () => {
      const studentMock = {
        id: 'student-stable',
        examTarget: { name: 'JEE' },
      };
      const attemptMock = [
        {
          id: 'att-1',
          examId: 'exam-1',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 240, maxScore: 300, percentage: 80.0, accuracy: 85.0 },
        },
      ];

      prismaMock.student.findFirst.mockResolvedValue(studentMock);
      prismaMock.attempt.findMany.mockResolvedValue(attemptMock);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockJEEHistorical);

      const res1 = await studentTargetPredictionService.getStudentTargetPrediction('student-stable');
      const res2 = await studentTargetPredictionService.getStudentTargetPrediction('student-stable');

      expect(res1.predictedRank).toEqual(res2.predictedRank);
      expect(res1.rankRange).toEqual(res2.rankRange);
      expect(res1.confidenceScore).toEqual(res2.confidenceScore);
    });

    // TEST CASE 10: Repeated mock attempts on same test are aggregated properly
    it('Scenario 10: discounts repeated attempts of the same mock to avoid score distortion', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-repeat',
        examTarget: { name: 'NEET' },
      });
      // Student took the SAME mock test 5 times
      const repeatedAttempts = [
        {
          id: 'att-5',
          examId: 'same-mock-exam-1',
          createdAt: new Date('2026-02-05'),
          result: { totalScore: 680, maxScore: 720, percentage: 94.4, accuracy: 96.0 },
        },
        {
          id: 'att-4',
          examId: 'same-mock-exam-1',
          createdAt: new Date('2026-02-04'),
          result: { totalScore: 640, maxScore: 720, percentage: 88.8, accuracy: 90.0 },
        },
        {
          id: 'att-3',
          examId: 'same-mock-exam-1',
          createdAt: new Date('2026-02-03'),
          result: { totalScore: 600, maxScore: 720, percentage: 83.3, accuracy: 85.0 },
        },
        {
          id: 'att-2',
          examId: 'same-mock-exam-1',
          createdAt: new Date('2026-02-02'),
          result: { totalScore: 560, maxScore: 720, percentage: 77.7, accuracy: 80.0 },
        },
        {
          id: 'att-1',
          examId: 'same-mock-exam-1',
          createdAt: new Date('2026-02-01'),
          result: { totalScore: 500, maxScore: 720, percentage: 69.4, accuracy: 75.0 },
        },
      ];

      prismaMock.attempt.findMany.mockResolvedValue(repeatedAttempts);
      prismaMock.historicalExam.findMany.mockResolvedValue(mockNEETHistorical);

      const result = await studentTargetPredictionService.getStudentTargetPrediction('student-repeat');

      expect(result.available).toBe(true);
      // Because all attempts belong to only 1 unique exam, confidence should not be inflated to HIGH
      expect(result.confidence).not.toBe('HIGH');
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
