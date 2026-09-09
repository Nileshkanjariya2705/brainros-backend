import { Test, TestingModule } from '@nestjs/testing';
import { StrategyRuleEngineService } from './services/strategy-rule-engine.service';
import { StrategyMetricCalculatorService } from './services/strategy-metric-calculator.service';
import { StrategyAnalyzerService } from './services/strategy-analyzer.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const prismaMock = {
  attempt: { findUnique: jest.fn(), findMany: jest.fn() },
  examQuestion: { findMany: jest.fn() },
  strategyRule: { findMany: jest.fn() },
  strategyAnalysis: { findUnique: jest.fn(), upsert: jest.fn() },
};

const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('Intelligent Attempt Strategy Decision Engine', () => {
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

    ruleEngine = module.get<StrategyRuleEngineService>(
      StrategyRuleEngineService,
    );
    metricCalculator = module.get<StrategyMetricCalculatorService>(
      StrategyMetricCalculatorService,
    );
    analyzerService = module.get<StrategyAnalyzerService>(
      StrategyAnalyzerService,
    );
    jest.clearAllMocks();
  });

  describe('StrategyRuleEngineService Operator Evaluation', () => {
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

    it('replaces placeholders with matching evidence values safely', () => {
      const template =
        'You attempted {highRiskAttemptCount} questions and {highRiskWrongCount} were wrong.';
      const result = ruleEngine.interpolateTemplate(template, {
        highRiskAttemptCount: 12,
        highRiskWrongCount: 7,
      });
      expect(result).toBe('You attempted 12 questions and 7 were wrong.');
    });
  });

  describe('Decision Case 1: OVER_ATTEMPTING Detection with High Confidence', () => {
    const mockAttempt = {
      id: 'attempt-case-1',
      studentId: 'student-1',
      examId: 'exam-neet',
      exam: {
        id: 'exam-neet',
        title: 'NEET Full Mock 2026',
        durationMinutes: 180,
        totalMarks: 720,
        defaultNegativeMarks: 1,
        examTargetId: 'target-neet',
      },
      result: {
        totalScore: 420,
        maxScore: 720,
        timeUsedSeconds: 10000,
      },
      answers: [
        // 12 hard questions attempted, 7 wrong (7 marks lost)
        ...Array(7)
          .fill(null)
          .map((_, i) => ({
            examQuestionId: `eq-hard-w-${i}`,
            selectedOptionId: 'wrong',
          })),
        ...Array(5)
          .fill(null)
          .map((_, i) => ({
            examQuestionId: `eq-hard-c-${i}`,
            selectedOptionId: 'correct',
          })),
        // 35 medium/easy questions, 30 correct, 5 wrong
        ...Array(30)
          .fill(null)
          .map((_, i) => ({
            examQuestionId: `eq-std-c-${i}`,
            selectedOptionId: 'correct',
          })),
        ...Array(5)
          .fill(null)
          .map((_, i) => ({
            examQuestionId: `eq-std-w-${i}`,
            selectedOptionId: 'wrong',
          })),
      ],
      timeLogs: [],
    };

    const mockQuestions = [
      ...Array(7)
        .fill(null)
        .map((_, i) => ({
          id: `eq-hard-w-${i}`,
          negativeMarks: 1,
          question: {
            id: `q-hw-${i}`,
            difficultyLevel: 'HARD',
            questionType: { code: 'SCQ' },
            chapter: { subject: { name: 'Physics' } },
            options: [
              { id: 'correct', isCorrect: true },
              { id: 'wrong', isCorrect: false },
            ],
          },
        })),
      ...Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `eq-hard-c-${i}`,
          negativeMarks: 1,
          question: {
            id: `q-hc-${i}`,
            difficultyLevel: 'HARD',
            questionType: { code: 'SCQ' },
            chapter: { subject: { name: 'Physics' } },
            options: [{ id: 'correct', isCorrect: true }],
          },
        })),
      ...Array(30)
        .fill(null)
        .map((_, i) => ({
          id: `eq-std-c-${i}`,
          negativeMarks: 1,
          question: {
            id: `q-sc-${i}`,
            difficultyLevel: 'EASY',
            questionType: { code: 'SCQ' },
            chapter: { subject: { name: 'Biology' } },
            options: [{ id: 'correct', isCorrect: true }],
          },
        })),
      ...Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `eq-std-w-${i}`,
          negativeMarks: 1,
          question: {
            id: `q-sw-${i}`,
            difficultyLevel: 'MEDIUM',
            questionType: { code: 'SCQ' },
            chapter: { subject: { name: 'Chemistry' } },
            options: [
              { id: 'correct', isCorrect: true },
              { id: 'wrong', isCorrect: false },
            ],
          },
        })),
    ];

    it('classifies OVER_ATTEMPTING with HIGH confidence and extracts Physics concentration', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.strategyAnalysis.findUnique.mockResolvedValue(null);
      prismaMock.attempt.findUnique.mockResolvedValue(mockAttempt);
      prismaMock.attempt.findMany.mockResolvedValue([]);
      prismaMock.examQuestion.findMany.mockResolvedValue(mockQuestions);
      prismaMock.strategyRule.findMany.mockResolvedValue([]);
      prismaMock.strategyAnalysis.upsert.mockResolvedValue({});

      const analysis = await analyzerService.generateStrategyAnalysis(
        'attempt-case-1',
        1,
      );

      expect(analysis.primaryClassification).toBe('OVER_ATTEMPTING');
      expect(analysis.confidence).toBe('HIGH');
      expect(analysis.metrics.highRiskAttemptCount).toBe(12);
      expect(analysis.metrics.highRiskWrongCount).toBe(7);
      expect(analysis.metrics.avoidableNegativeMarks).toBe(7);
      expect(analysis.whyStatement).toContain('12 high-risk questions and 7 were incorrect');
      expect(analysis.whyStatement).toContain('Physics');
      expect(analysis.signals.length).toBeGreaterThan(0);
      expect(analysis.actionRecommendation?.type).toBe('STRATEGY_ANALYSIS');
    });
  });

  describe('Decision Case 2: UNDER_ATTEMPTING Detection', () => {
    it('detects UNDER_ATTEMPTING when accuracy is 88% and 25% questions left unanswered with surplus time', () => {
      const summaryMetrics: any = {
        totalQuestions: 50,
        attemptedCount: 38,
        attemptedPercentage: 76,
        unattemptedCount: 12,
        unattemptedPercentage: 24,
        correctCount: 34,
        wrongCount: 4,
        accuracy: 89.47,
        highRiskAttemptCount: 2,
        highRiskWrongCount: 1,
        highRiskAccuracy: 50,
        negativeMarksLost: 4,
        avoidableNegativeMarks: 1,
        unusedTimeMinutes: 25,
        unusedTimePercentage: 28,
        averageTimePerQuestionSeconds: 65,
        timeHeavyWrongCount: 0,
        timeHeavyAttemptCount: 2,
        sampleSizeLevel: 'HIGH',
      };

      const result = ruleEngine.evaluateDecisionEngine({
        rules: [],
        metrics: summaryMetrics,
        metricMap: new Map(),
      });

      expect(result.primaryClassification).toBe('UNDER_ATTEMPTING');
      expect(result.confidence).toBe('HIGH');
      expect(result.whyStatement).toContain('high accuracy of 89.47%');
      expect(result.whyStatement).toContain('12 questions unattempted');
      expect(result.whyStatement).toContain('25 minutes of unused time');
      expect(result.actionRecommendation.type).toBe('TIMED_MOCK');
    });
  });

  describe('Decision Case 3: TIME_MANAGEMENT / TIME_HEAVY Detection', () => {
    it('detects TIME_HEAVY when accuracy is 78% but time spent per question is excessive on errors', () => {
      const summaryMetrics: any = {
        totalQuestions: 40,
        attemptedCount: 36,
        attemptedPercentage: 90,
        unattemptedCount: 4,
        unattemptedPercentage: 10,
        correctCount: 28,
        wrongCount: 8,
        accuracy: 77.78,
        highRiskAttemptCount: 2,
        highRiskWrongCount: 1,
        highRiskAccuracy: 50,
        negativeMarksLost: 4,
        avoidableNegativeMarks: 1,
        unusedTimeMinutes: 0,
        unusedTimePercentage: 0,
        averageTimePerQuestionSeconds: 115,
        timeHeavyWrongCount: 5,
        timeHeavyAttemptCount: 10,
        sampleSizeLevel: 'HIGH',
      };

      const result = ruleEngine.evaluateDecisionEngine({
        rules: [],
        metrics: summaryMetrics,
        metricMap: new Map(),
      });

      expect(result.primaryClassification).toBe('TIME_HEAVY');
      expect(result.whyStatement).toContain('5 incorrect questions');
      expect(result.whyStatement).toContain('115s per question');
      expect(result.recommendations[0].title).toContain('90-Second');
    });
  });

  describe('Decision Case 4: Knowledge Gap Distinction (Not Misclassified as Strategy Defect)', () => {
    it('classifies KNOWLEDGE_GAP when overall accuracy is 40% on standard difficulty questions without wild guessing', () => {
      const summaryMetrics: any = {
        totalQuestions: 40,
        attemptedCount: 35,
        attemptedPercentage: 87.5,
        unattemptedCount: 5,
        unattemptedPercentage: 12.5,
        correctCount: 14,
        wrongCount: 21,
        accuracy: 40.0,
        highRiskAttemptCount: 1,
        highRiskWrongCount: 1,
        highRiskAccuracy: 0,
        negativeMarksLost: 5,
        avoidableNegativeMarks: 1,
        unusedTimeMinutes: 2,
        unusedTimePercentage: 2,
        averageTimePerQuestionSeconds: 65,
        timeHeavyWrongCount: 1,
        timeHeavyAttemptCount: 2,
        sampleSizeLevel: 'HIGH',
      };

      const result = ruleEngine.evaluateDecisionEngine({
        rules: [],
        metrics: summaryMetrics,
        metricMap: new Map(),
      });

      expect(result.primaryClassification).toBe('KNOWLEDGE_GAP');
      expect(result.primaryClassification).not.toBe('OVER_ATTEMPTING');
      expect(result.primaryClassification).not.toBe('UNDER_ATTEMPTING');
      expect(result.whyStatement).toContain('foundational concepts');
      expect(result.actionRecommendation.type).toBe('CHAPTER_PRACTICE');
    });
  });

  describe('Decision Case 5: Sample Size Protection (Insufficient Data)', () => {
    it('safely handles attempts with < 5 questions and returns LOW confidence without strong claims', () => {
      const summaryMetrics: any = {
        totalQuestions: 3,
        attemptedCount: 2,
        attemptedPercentage: 66.7,
        unattemptedCount: 1,
        unattemptedPercentage: 33.3,
        correctCount: 1,
        wrongCount: 1,
        accuracy: 50.0,
        highRiskAttemptCount: 1,
        highRiskWrongCount: 1,
        highRiskAccuracy: 0,
        negativeMarksLost: 1,
        avoidableNegativeMarks: 1,
        unusedTimeMinutes: 45,
        unusedTimePercentage: 75,
        averageTimePerQuestionSeconds: 60,
        timeHeavyWrongCount: 0,
        timeHeavyAttemptCount: 0,
        sampleSizeLevel: 'INSUFFICIENT',
      };

      const result = ruleEngine.evaluateDecisionEngine({
        rules: [],
        metrics: summaryMetrics,
        metricMap: new Map(),
      });

      expect(result.primaryClassification).toBe('INSUFFICIENT_DATA');
      expect(result.confidence).toBe('LOW');
      expect(result.whyStatement).toContain('less than 5 questions');
      expect(result.recommendations[0].ruleCode).toBe('INSUFFICIENT_DATA');
    });
  });

  describe('Decision Case 6: Historical Trajectory Trend Awareness (Improving Trend)', () => {
    it('recognizes IMPROVING trend and provides positive reinforcement instead of harsh scolding', () => {
      const summaryMetrics: any = {
        totalQuestions: 50,
        attemptedCount: 45,
        attemptedPercentage: 90,
        unattemptedCount: 5,
        unattemptedPercentage: 10,
        correctCount: 35,
        wrongCount: 10,
        accuracy: 77.78,
        highRiskAttemptCount: 5, // Dropped from historical 14
        highRiskWrongCount: 3,
        highRiskAccuracy: 40,
        negativeMarksLost: 5,
        avoidableNegativeMarks: 3,
        unusedTimeMinutes: 5,
        unusedTimePercentage: 5,
        averageTimePerQuestionSeconds: 65,
        timeHeavyWrongCount: 1,
        timeHeavyAttemptCount: 2,
        sampleSizeLevel: 'HIGH',
      };

      const result = ruleEngine.evaluateDecisionEngine({
        rules: [],
        metrics: summaryMetrics,
        metricMap: new Map(),
        historicalTrend: 'IMPROVING',
        historicalAttemptsCount: 3,
      });

      expect(result.trend).toBe('IMPROVING');
      expect(result.whyStatement).toContain('decreased significantly');
      expect(result.recommendations[0].title).toContain('Maintain High Question Selectivity');
    });
  });

  describe('Decision Case 7: Zero Negative Marking Exam Handling', () => {
    it('does not produce negative marking penalty claims when exam has 0 negative marks', () => {
      const mockAttempt = {
        id: 'attempt-zero-neg',
        studentId: 'student-2',
        examId: 'exam-cet',
        exam: {
          id: 'exam-cet',
          title: 'MHT-CET Mock (No Negative Marking)',
          durationMinutes: 90,
          totalMarks: 100,
          defaultNegativeMarks: 0,
        },
        result: { totalScore: 70, maxScore: 100, timeUsedSeconds: 5000 },
        answers: [
          { examQuestionId: 'eq-1', selectedOptionId: 'wrong' },
          { examQuestionId: 'eq-2', selectedOptionId: 'wrong' },
        ],
        timeLogs: [],
      };

      const mockQuestions = [
        {
          id: 'eq-1',
          negativeMarks: 0,
          question: {
            id: 'q-1',
            difficultyLevel: 'HARD',
            questionType: { code: 'SCQ' },
            options: [
              { id: 'correct', isCorrect: true },
              { id: 'wrong', isCorrect: false },
            ],
          },
        },
        {
          id: 'eq-2',
          negativeMarks: 0,
          question: {
            id: 'q-2',
            difficultyLevel: 'HARD',
            questionType: { code: 'SCQ' },
            options: [
              { id: 'correct', isCorrect: true },
              { id: 'wrong', isCorrect: false },
            ],
          },
        },
      ];

      const { summary } = metricCalculator.calculateMetrics({
        attempt: mockAttempt,
        examQuestions: mockQuestions,
        answers: mockAttempt.answers,
        timeLogs: [],
      });

      expect(summary.negativeMarksLost).toBe(0);
      expect(summary.avoidableNegativeMarks).toBe(0);
      expect(summary.projectedImprovementMarks).toBe(0);
      expect(summary.projectedScore).toBe(70);
    });
  });
});
