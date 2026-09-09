import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StrategyMetricCalculatorService } from './strategy-metric-calculator.service';
import {
  StrategyRuleEngineService,
  StrategyRuleEntity,
} from './strategy-rule-engine.service';
import {
  DetailedStrategyAnalysis,
  StrategySummaryMetrics,
  StrategyRecommendationItem,
  StrategyTrend,
} from '../interfaces/attempt-strategy.interface';

@Injectable()
export class StrategyAnalyzerService {
  private readonly logger = new Logger(StrategyAnalyzerService.name);
  private readonly CURRENT_ALGORITHM_VERSION = 'v2.0.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly metricCalculator: StrategyMetricCalculatorService,
    private readonly ruleEngine: StrategyRuleEngineService,
  ) {}

  private getCacheKey(attemptId: string, version: number): string {
    return `attempt:${attemptId}:strategy:${version}`;
  }

  /**
   * Generate, persist, and cache Strategy Analysis for an evaluated attempt
   */
  async generateStrategyAnalysis(
    attemptId: string,
    strategyVersion: number = 1,
  ): Promise<DetailedStrategyAnalysis> {
    // 1. Check Redis cache
    try {
      const cached = await this.redisService.get(
        this.getCacheKey(attemptId, strategyVersion),
      );
      if (cached) {
        return JSON.parse(cached) as DetailedStrategyAnalysis;
      }
    } catch (e) {}

    // 2. Check DB for existing analysis
    const existing = await this.prisma.strategyAnalysis.findUnique({
      where: { attemptId_strategyVersion: { attemptId, strategyVersion } },
    });
    if (existing) {
      const parsed = existing.data as unknown as DetailedStrategyAnalysis;
      try {
        await this.redisService.set(
          this.getCacheKey(attemptId, strategyVersion),
          JSON.stringify(parsed),
          86400 * 7,
        );
      } catch (e) {}
      return parsed;
    }

    // 3. Load attempt data
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            sections: true,
            examTarget: true,
          },
        },
        result: true,
        answers: true,
        timeLogs: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt '${attemptId}' not found`);
    }

    // Load exam questions
    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: attempt.examId },
      orderBy: { displayOrder: 'asc' },
      include: {
        section: true,
        question: {
          include: {
            questionType: true,
            chapter: { include: { subject: true } },
            options: true,
          },
        },
      },
    });

    // 4. Historical Lookback: Query student's past attempts to evaluate behavioral trajectory
    let historicalTrend: StrategyTrend = 'INSUFFICIENT_HISTORY';
    let pastAttemptsCount = 0;

    try {
      const pastAttempts: any[] = await this.prisma.attempt.findMany({
        where: {
          studentId: attempt.studentId,
          status: { name: 'EVALUATED' },
          id: { not: attemptId },
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
        include: {
          strategyAnalyses: {
            orderBy: { strategyVersion: 'desc' },
            take: 1,
          },
          result: true,
        },
      });

      pastAttemptsCount = pastAttempts.length;

      if (pastAttempts.length >= 2) {
        const riskyCounts = pastAttempts
          .map((a) => {
            const sa = a.strategyAnalyses?.[0];
            const data = sa?.data as any;
            return (
              data?.metrics?.highRiskAttemptCount ??
              (a.result ? Math.ceil((a.result.wrongAnswers || 0) * 0.5) : 0)
            );
          })
          .filter((v) => typeof v === 'number');

        if (riskyCounts.length >= 2) {
          // Check if sequence is decreasing or increasing over time (ordered oldest to newest)
          const chronological = [...riskyCounts].reverse();
          const first = chronological[0];
          const last = chronological[chronological.length - 1];

          if (first - last >= 3) {
            historicalTrend = 'IMPROVING';
          } else if (last - first >= 3) {
            historicalTrend = 'DECLINING';
          } else {
            historicalTrend = 'STABLE';
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Could not compute historical trend for attempt ${attemptId}: ${err}`);
    }

    // 5. Calculate normalized metrics & structured signals
    const { summary, metricMap } = this.metricCalculator.calculateMetrics({
      attempt,
      examQuestions,
      answers: attempt.answers,
      timeLogs: attempt.timeLogs,
    });

    // 6. Load active strategy rules
    const dbRules = await this.prisma.strategyRule.findMany({
      where: {
        isActive: true,
        OR: [
          { examId: attempt.examId },
          { examTargetId: attempt.exam.examTargetId },
          { examId: null, examTargetId: null },
        ],
      },
      orderBy: { priority: 'asc' },
    });

    const mappedRules: StrategyRuleEntity[] = dbRules.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      category: r.category,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      comparisonValue: r.comparisonValue,
      severity: r.severity,
      priority: r.priority,
      recommendationTemplate: r.recommendationTemplate,
      titleTemplate: r.titleTemplate,
      isActive: r.isActive,
      configVersion: r.configVersion,
    }));

    // 7. Evaluate Intelligent Decision Engine
    const decision = this.ruleEngine.evaluateDecisionEngine({
      rules: mappedRules,
      metrics: summary,
      metricMap,
      historicalTrend,
      historicalAttemptsCount: pastAttemptsCount,
    });

    const report: DetailedStrategyAnalysis = {
      attemptId,
      examId: attempt.examId,
      examTitle: attempt.exam.title,
      strategyVersion,
      algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
      generatedAt: new Date().toISOString(),
      primaryClassification: decision.primaryClassification,
      confidence: decision.confidence,
      confidenceScore: decision.confidenceScore,
      trend: decision.trend,
      whyStatement: decision.whyStatement,
      signals: decision.signals,
      classifications: decision.classifications,
      secondaryClassifications: decision.secondaryClassifications,
      metrics: summary,
      recommendations: decision.recommendations,
      actionRecommendation: decision.actionRecommendation,
      projectedImprovement: {
        estimatedAvoidableLossMarks: summary.avoidableNegativeMarks,
        projectedScore: summary.projectedScore,
        actualScore: summary.actualObtainedMarks,
        disclaimer:
          'Estimated avoidable loss is calculated from the exam marking scheme on high-risk incorrect answers, not a guaranteed score.',
      },
    };

    // 8. Persist & cache
    await this.prisma.strategyAnalysis.upsert({
      where: { attemptId_strategyVersion: { attemptId, strategyVersion } },
      update: {
        primaryClassification: decision.primaryClassification,
        classifications: decision.classifications,
        metrics: summary as any,
        recommendations: decision.recommendations as any,
        projectedImprovementMarks: summary.projectedImprovementMarks,
        projectedScore: summary.projectedScore,
        avoidableNegativeMarks: summary.avoidableNegativeMarks,
        data: report as any,
      },
      create: {
        attemptId,
        strategyVersion,
        algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
        primaryClassification: decision.primaryClassification,
        classifications: decision.classifications,
        metrics: summary as any,
        recommendations: decision.recommendations as any,
        projectedImprovementMarks: summary.projectedImprovementMarks,
        projectedScore: summary.projectedScore,
        avoidableNegativeMarks: summary.avoidableNegativeMarks,
        data: report as any,
      },
    });

    try {
      await this.redisService.set(
        this.getCacheKey(attemptId, strategyVersion),
        JSON.stringify(report),
        86400 * 7,
      );
    } catch (e) {}

    return report;
  }

  /**
   * Recalculate strategy analysis
   */
  async recalculateStrategyAnalysis(
    attemptId: string,
    version: number = 1,
  ): Promise<DetailedStrategyAnalysis> {
    try {
      await this.redisService.del(this.getCacheKey(attemptId, version));
    } catch (e) {}
    return this.generateStrategyAnalysis(attemptId, version);
  }

  /**
   * Granular Queries
   */
  async getMetrics(attemptId: string): Promise<StrategySummaryMetrics> {
    const full = await this.generateStrategyAnalysis(attemptId);
    return full.metrics;
  }

  async getRecommendations(
    attemptId: string,
  ): Promise<StrategyRecommendationItem[]> {
    const full = await this.generateStrategyAnalysis(attemptId);
    return full.recommendations;
  }
}
