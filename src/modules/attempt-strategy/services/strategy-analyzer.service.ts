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
} from '../interfaces/attempt-strategy.interface';

@Injectable()
export class StrategyAnalyzerService {
  private readonly logger = new Logger(StrategyAnalyzerService.name);
  private readonly CURRENT_ALGORITHM_VERSION = 'v1.0.0';

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

    // 4. Calculate normalized metrics
    const { summary, metricMap } = this.metricCalculator.calculateMetrics({
      attempt,
      examQuestions,
      answers: attempt.answers,
      timeLogs: attempt.timeLogs,
    });

    // 5. Load active strategy rules
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

    // 6. Evaluate rules
    const { classifications, recommendations, primaryClassification } =
      this.ruleEngine.evaluateRules({
        rules: mappedRules,
        metrics: summary,
        metricMap,
      });

    const report: DetailedStrategyAnalysis = {
      attemptId,
      examId: attempt.examId,
      examTitle: attempt.exam.title,
      strategyVersion,
      algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
      generatedAt: new Date().toISOString(),
      primaryClassification,
      classifications,
      metrics: summary,
      recommendations,
      projectedImprovement: {
        estimatedAvoidableLossMarks: summary.avoidableNegativeMarks,
        projectedScore: summary.projectedScore,
        actualScore: summary.actualObtainedMarks,
        disclaimer:
          'Projected score improvement is an estimate based on eliminating avoidable losses from high-risk incorrect attempts.',
      },
    };

    // 7. Persist & cache
    await this.prisma.strategyAnalysis.upsert({
      where: { attemptId_strategyVersion: { attemptId, strategyVersion } },
      update: {
        primaryClassification,
        classifications,
        metrics: summary as any,
        recommendations: recommendations as any,
        projectedImprovementMarks: summary.projectedImprovementMarks,
        projectedScore: summary.projectedScore,
        avoidableNegativeMarks: summary.avoidableNegativeMarks,
        data: report as any,
      },
      create: {
        attemptId,
        strategyVersion,
        algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
        primaryClassification,
        classifications,
        metrics: summary as any,
        recommendations: recommendations as any,
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
