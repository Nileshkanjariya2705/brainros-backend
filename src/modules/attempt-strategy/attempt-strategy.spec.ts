import { Test, TestingModule } from '@nestjs/testing';
import { StrategyRuleEngineService } from './services/strategy-rule-engine.service';
import { StrategyMetricCalculatorService } from './services/strategy-metric-calculator.service';
import { StrategyAnalyzerService } from './services/strategy-analyzer.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const prismaMock = {
  attempt: { findUnique: jest.fn() },
  examQuestion: { findMany: jest.fn() },
  strategyRule: { findMany: jest.fn() },
  strategyAnalysis: { findUnique: jest.fn(), upsert: jest.fn() },
};

const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('Attempt Strategy Analysis Subsystem', () => {
  let ruleEngine: StrategyRuleEngineService;
  let metricCalculator: StrategyMetricCalculatorService;
  let analyzerService: StrategyAnalyzerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyRuleEngineService,
        StrategyMetricCalculatorService,
        StrategyAnalyzerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    ruleEngine = module.get<StrategyRuleEngineService>(StrategyRuleEngineService);
    metricCalculator = module.get<StrategyMetricCalculatorService>(StrategyMetricCalculatorService);
    analyzerService = module.get<StrategyAnalyzerService>(StrategyAnalyzerService);
    jest.clearAllMocks();
  });

  describe('StrategyRuleEngineService', () => {
    describe('evaluateOperator', () => {
      it('correctly evaluates GT, GTE, LT, LTE, EQ, BETWEEN', () => {
        expect(ruleEngine.evaluateOperator(10, 'GT', 5)).toBe(true);
        expect(ruleEngine.evaluateOperator(5, 'GT', 5)).toBe(false);
        expect(ruleEngine.evaluateOperator(5, 'GTE', 5)).toBe(true);
        expect(ruleEngine.evaluateOperator(3, 'LT', 5)).toBe(true);
        expect(ruleEngine.evaluateOperator(5, 'LTE', 5)).toBe(true);
        expect(ruleEngine.evaluateOperator(5, 'EQ', 5)).toBe(true);
        expect(ruleEngine.evaluateOperator(7, 'BETWEEN', 5, 10)).toBe(true);
        expect(ruleEngine.evaluateOperator(12, 'BETWEEN', 5, 10)).toBe(false);
      });

      it('returns false for unsupported operator', () => {
        expect(ruleEngine.evaluateOperator(10, 'INVALID', 5)).toBe(false);
      });
    });

    describe('interpolateTemplate', () => {
      it('replaces placeholders with matching evidence values without executing code', () => {
        const template = 'You attempted {highRiskAttemptCount} questions and {highRiskWrongCount} were wrong.';
        const result = ruleEngine.interpolateTemplate(template, {
          highRiskAttemptCount: 12,
          highRiskWrongCount: 7,
        });
        expect(result).toBe('You attempted 12 questions and 7 were wrong.');
      });
    });
  });

  describe('StrategyMetricCalculatorService', () => {
    const mockAttempt = {
      id: 'attempt-1',
      exam: {
        id: 'exam-1',
        title: 'JEE Mock Test',
        durationMinutes: 60,
        totalMarks: 100,
        defaultNegativeMarks: 1,
      },
      result: {
        totalScore: 40,
        maxScore: 100,
      },
    };

    const mockExamQuestions = [
      {
        id: 'eq-1',
        negativeMarks: 1,
        question: {
          id: 'q-1',
          difficultyLevel: 'HARD',
          questionType: { code: 'SCQ' },
          options: [{ id: 'opt-1', isCorrect: true }, { id: 'opt-2', isCorrect: false }],
        },
      },
      {
        id: 'eq-2',
        negativeMarks: 1,
        question: {
          id: 'q-2',
          difficultyLevel: 'HARD',
          questionType: { code: 'SCQ' },
          options: [{ id: 'opt-3', isCorrect: true }, { id: 'opt-4', isCorrect: false }],
        },
      },
      {
        id: 'eq-3',
        negativeMarks: 1,
        question: {
          id: 'q-3',
          difficultyLevel: 'EASY',
          questionType: { code: 'SCQ' },
          options: [{ id: 'opt-5', isCorrect: true }],
        },
      },
    ];

    it('accurately computes high risk attempts, negative marks lost, and projected improvement', () => {
      const answers = [
        { examQuestionId: 'eq-1', selectedOptionId: 'opt-2' }, // WRONG (Hard) -> 1 mark lost
        { examQuestionId: 'eq-2', selectedOptionId: 'opt-4' }, // WRONG (Hard) -> 1 mark lost
        { examQuestionId: 'eq-3', selectedOptionId: 'opt-5' }, // CORRECT (Easy)
      ];

      const { summary, metricMap } = metricCalculator.calculateMetrics({
        attempt: mockAttempt,
        examQuestions: mockExamQuestions,
        answers,
        timeLogs: [],
      });

      expect(summary.totalQuestions).toBe(3);
      expect(summary.attemptedCount).toBe(3);
      expect(summary.correctCount).toBe(1);
      expect(summary.wrongCount).toBe(2);
      expect(summary.highRiskAttemptCount).toBe(2);
      expect(summary.highRiskWrongCount).toBe(2);
      expect(summary.negativeMarksLost).toBe(2);
      expect(summary.avoidableNegativeMarks).toBe(2);
      expect(summary.projectedImprovementMarks).toBe(2);
      expect(summary.projectedScore).toBe(42); // 40 + 2

      expect(metricMap.get('HIGH_RISK_WRONG_COUNT')?.value).toBe(2);
      expect(metricMap.get('AVOIDABLE_NEGATIVE_MARKS')?.value).toBe(2);
    });
  });

  describe('Full Strategy Analyzer & Rule Evaluation', () => {
    const attemptId = 'attempt-1001';

    it('classifies HIGH_RISK_ATTEMPTING and generates structured recommendations with evidence', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.strategyAnalysis.findUnique.mockResolvedValue(null);

      const mockAttempt = {
        id: attemptId,
        examId: 'exam-1',
        exam: {
          id: 'exam-1',
          title: 'NEET Practice Test',
          durationMinutes: 180,
          totalMarks: 720,
          defaultNegativeMarks: 4,
          examTargetId: 'target-1',
        },
        result: {
          totalScore: 500,
          maxScore: 720,
        },
        answers: [
          // 12 hard questions attempted, 7 wrong (28 marks lost)
          ...Array(7).fill(null).map((_, i) => ({ examQuestionId: `eq-h-w-${i}`, selectedOptionId: 'wrong' })),
          ...Array(5).fill(null).map((_, i) => ({ examQuestionId: `eq-h-c-${i}`, selectedOptionId: 'correct' })),
        ],
        timeLogs: [],
      };

      const mockExamQuestions = [
        ...Array(7).fill(null).map((_, i) => ({
          id: `eq-h-w-${i}`,
          negativeMarks: 4,
          question: {
            id: `q-h-w-${i}`,
            difficultyLevel: 'HARD',
            questionType: { code: 'SCQ' },
            options: [{ id: 'correct', isCorrect: true }, { id: 'wrong', isCorrect: false }],
          },
        })),
        ...Array(5).fill(null).map((_, i) => ({
          id: `eq-h-c-${i}`,
          negativeMarks: 4,
          question: {
            id: `q-h-c-${i}`,
            difficultyLevel: 'HARD',
            questionType: { code: 'SCQ' },
            options: [{ id: 'correct', isCorrect: true }],
          },
        })),
      ];

      prismaMock.attempt.findUnique.mockResolvedValue(mockAttempt);
      prismaMock.examQuestion.findMany.mockResolvedValue(mockExamQuestions);
      prismaMock.strategyRule.findMany.mockResolvedValue([]);
      prismaMock.strategyAnalysis.upsert.mockResolvedValue({});
      redisMock.set.mockResolvedValue(undefined);

      const result = await analyzerService.generateStrategyAnalysis(attemptId, 1);

      expect(result.attemptId).toBe(attemptId);
      expect(result.metrics.highRiskAttemptCount).toBe(12);
      expect(result.metrics.highRiskWrongCount).toBe(7);
      expect(result.metrics.negativeMarksLost).toBe(28);
      expect(result.metrics.avoidableNegativeMarks).toBe(28);
      expect(result.projectedImprovement.estimatedAvoidableLossMarks).toBe(28);
      expect(result.projectedImprovement.projectedScore).toBe(528);

      expect(result.classifications).toContain('HIGH_RISK_ATTEMPTING');
      expect(result.classifications).toContain('NEGATIVE_MARKING_HEAVY');
      expect(result.recommendations.length).toBeGreaterThan(0);

      const rec = result.recommendations[0];
      expect(rec.message).toContain('You attempted 12 high-risk questions and 7 were incorrect');
      expect(rec.message).toContain('Estimated avoidable loss: 28 marks');

      // Persistence & Cache verified
      expect(prismaMock.strategyAnalysis.upsert).toHaveBeenCalled();
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('classifies BALANCED when no risk threshold is triggered', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.strategyAnalysis.findUnique.mockResolvedValue(null);

      const mockAttempt = {
        id: 'attempt-balanced',
        examId: 'exam-1',
        exam: {
          id: 'exam-1',
          title: 'Test',
          durationMinutes: 60,
          totalMarks: 100,
          defaultNegativeMarks: 1,
        },
        result: { totalScore: 90, maxScore: 100 },
        answers: [
          { examQuestionId: 'eq-1', selectedOptionId: 'correct' },
          { examQuestionId: 'eq-2', selectedOptionId: 'correct' },
        ],
        timeLogs: [],
      };

      const mockExamQuestions = [
        {
          id: 'eq-1',
          negativeMarks: 1,
          question: {
            id: 'q-1',
            difficultyLevel: 'EASY',
            questionType: { code: 'SCQ' },
            options: [{ id: 'correct', isCorrect: true }],
          },
        },
        {
          id: 'eq-2',
          negativeMarks: 1,
          question: {
            id: 'q-2',
            difficultyLevel: 'MEDIUM',
            questionType: { code: 'SCQ' },
            options: [{ id: 'correct', isCorrect: true }],
          },
        },
      ];

      prismaMock.attempt.findUnique.mockResolvedValue(mockAttempt);
      prismaMock.examQuestion.findMany.mockResolvedValue(mockExamQuestions);
      prismaMock.strategyRule.findMany.mockResolvedValue([]);
      prismaMock.strategyAnalysis.upsert.mockResolvedValue({});

      const result = await analyzerService.generateStrategyAnalysis('attempt-balanced', 1);

      expect(result.primaryClassification).toBe('BALANCED');
      expect(result.classifications).toEqual(['BALANCED']);
      expect(result.recommendations[0].title).toBe('Balanced Attempt Strategy');
    });
  });
});
