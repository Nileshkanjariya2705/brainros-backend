import { Injectable, Logger } from '@nestjs/common';
import {
  StrategyOperator,
  StrategySeverity,
  StrategyRecommendationItem,
  StrategyClassificationCode,
  StrategySummaryMetrics,
  StrategyMetricItem,
} from '../interfaces/attempt-strategy.interface';

export interface StrategyRuleEntity {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category: string;
  metric: string;
  operator: string;
  threshold: number;
  comparisonValue?: number | null;
  severity: string;
  priority: number;
  recommendationTemplate: string;
  titleTemplate: string;
  isActive: boolean;
  configVersion: number;
}

@Injectable()
export class StrategyRuleEngineService {
  private readonly logger = new Logger(StrategyRuleEngineService.name);

  /**
   * Safe in-memory operator evaluator
   */
  evaluateOperator(
    value: number,
    operator: StrategyOperator | string,
    threshold: number,
    comparisonValue?: number | null,
  ): boolean {
    switch (operator) {
      case 'GT':
        return value > threshold;
      case 'GTE':
        return value >= threshold;
      case 'LT':
        return value < threshold;
      case 'LTE':
        return value <= threshold;
      case 'EQ':
        return Math.abs(value - threshold) < 0.0001;
      case 'BETWEEN':
        if (comparisonValue === null || comparisonValue === undefined)
          return false;
        return value >= threshold && value <= comparisonValue;
      case 'PERCENT_GT':
        return value > threshold;
      case 'PERCENT_LT':
        return value < threshold;
      default:
        this.logger.warn(`Unsupported rule operator: ${operator}`);
        return false;
    }
  }

  /**
   * Safe template variable interpolation
   */
  interpolateTemplate(template: string, evidence: Record<string, any>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      if (evidence[key] !== undefined && evidence[key] !== null) {
        return String(evidence[key]);
      }
      return `{${key}}`;
    });
  }

  /**
   * Evaluate active rules against computed metrics
   */
  evaluateRules(params: {
    rules: StrategyRuleEntity[];
    metrics: StrategySummaryMetrics;
    metricMap: Map<string, StrategyMetricItem>;
    maxRecommendations?: number;
  }): {
    classifications: StrategyClassificationCode[];
    recommendations: StrategyRecommendationItem[];
    primaryClassification: StrategyClassificationCode;
  } {
    const { rules, metrics, metricMap, maxRecommendations = 5 } = params;
    const classifications = new Set<StrategyClassificationCode>();
    const recMap = new Map<string, StrategyRecommendationItem>();

    const activeRules =
      rules.length > 0
        ? rules.filter((r) => r.isActive)
        : this.getDefaultSeedRules();

    for (const rule of activeRules) {
      const metricItem = metricMap.get(rule.metric);
      if (!metricItem) continue;

      const isMatch = this.evaluateOperator(
        metricItem.value,
        rule.operator,
        rule.threshold,
        rule.comparisonValue,
      );

      if (isMatch) {
        // Map to classification
        const classCode = this.mapRuleToClassification(rule.code);
        if (classCode) {
          classifications.add(classCode);
        }

        // Build evidence
        const evidence: Record<string, any> = {
          ...metrics,
          matchedMetric: rule.metric,
          matchedValue: metricItem.value,
          threshold: rule.threshold,
        };

        const title = this.interpolateTemplate(rule.titleTemplate, evidence);
        const message = this.interpolateTemplate(
          rule.recommendationTemplate,
          evidence,
        );

        const estimatedImpactMarks =
          rule.code === 'HIGH_RISK_ATTEMPTING' ||
          rule.code === 'NEGATIVE_MARKING_HEAVY'
            ? metrics.avoidableNegativeMarks
            : 0;

        recMap.set(rule.code, {
          id: rule.id,
          ruleCode: rule.code,
          category: rule.category as any,
          title,
          message,
          severity: rule.severity as StrategySeverity,
          priority: rule.priority,
          evidence,
          estimatedImpactMarks,
        });
      }
    }

    // Default to BALANCED if no risk flags triggered
    if (classifications.size === 0) {
      classifications.add('BALANCED');
      recMap.set('BALANCED', {
        id: 'rule-balanced',
        ruleCode: 'BALANCED',
        category: 'ATTEMPT_COVERAGE',
        title: 'Balanced Attempt Strategy',
        message: `You maintained a healthy balance with ${metrics.attemptedPercentage}% attempt coverage and ${metrics.accuracy}% accuracy while keeping negative marking controlled.`,
        severity: 'INFO',
        priority: 10,
        evidence: { ...metrics },
        estimatedImpactMarks: 0,
      });
    }

    // Rank recommendations by Priority (ascending), then Severity (Critical > High > Medium > Low), then Impact (descending)
    const severityScore = (s: StrategySeverity) => {
      switch (s) {
        case 'CRITICAL':
          return 5;
        case 'HIGH':
          return 4;
        case 'MEDIUM':
          return 3;
        case 'LOW':
          return 2;
        default:
          return 1;
      }
    };

    const sortedRecs = Array.from(recMap.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const sevDiff = severityScore(b.severity) - severityScore(a.severity);
      if (sevDiff !== 0) return sevDiff;
      return b.estimatedImpactMarks - a.estimatedImpactMarks;
    });

    const primaryClassification = classifications.has('HIGH_RISK_ATTEMPTING')
      ? 'HIGH_RISK_ATTEMPTING'
      : classifications.has('NEGATIVE_MARKING_HEAVY')
        ? 'NEGATIVE_MARKING_HEAVY'
        : classifications.has('OVER_ATTEMPTING')
          ? 'OVER_ATTEMPTING'
          : classifications.has('UNDER_ATTEMPTING')
            ? 'UNDER_ATTEMPTING'
            : classifications.has('TIME_HEAVY')
              ? 'TIME_HEAVY'
              : 'BALANCED';

    return {
      classifications: Array.from(classifications),
      recommendations: sortedRecs.slice(0, maxRecommendations),
      primaryClassification,
    };
  }

  private mapRuleToClassification(
    code: string,
  ): StrategyClassificationCode | null {
    if (code.includes('HIGH_RISK')) return 'HIGH_RISK_ATTEMPTING';
    if (code.includes('NEGATIVE')) return 'NEGATIVE_MARKING_HEAVY';
    if (code.includes('OVER_ATTEMPT')) return 'OVER_ATTEMPTING';
    if (code.includes('UNDER_ATTEMPT')) return 'UNDER_ATTEMPTING';
    if (code.includes('TIME')) return 'TIME_HEAVY';
    return null;
  }

  /**
   * Default production seed rules
   */
  getDefaultSeedRules(): StrategyRuleEntity[] {
    return [
      {
        id: 'seed-1',
        code: 'HIGH_RISK_ATTEMPTING',
        name: 'High Risk Attempting',
        category: 'RISK',
        metric: 'HIGH_RISK_WRONG_COUNT',
        operator: 'GTE',
        threshold: 4,
        severity: 'HIGH',
        priority: 1,
        titleTemplate: 'Selective Question Attempt Strategy',
        recommendationTemplate:
          'You attempted {highRiskAttemptCount} high-risk questions and {highRiskWrongCount} were incorrect. Estimated avoidable loss: {avoidableNegativeMarks} marks.',
        isActive: true,
        configVersion: 1,
      },
      {
        id: 'seed-2',
        code: 'NEGATIVE_MARKING_HEAVY',
        name: 'Heavy Negative Marking Impact',
        category: 'NEGATIVE_MARKING',
        metric: 'NEGATIVE_MARKS_LOST',
        operator: 'GTE',
        threshold: 12,
        severity: 'HIGH',
        priority: 2,
        titleTemplate: 'Negative Marking Reduction',
        recommendationTemplate:
          'Negative marking reduced your score by {negativeMarksLost} marks across {wrongCount} incorrect answers. Eliminating blind guesses will preserve marks.',
        isActive: true,
        configVersion: 1,
      },
      {
        id: 'seed-3',
        code: 'UNDER_ATTEMPTING',
        name: 'Under Attempting with High Accuracy',
        category: 'ATTEMPT_COVERAGE',
        metric: 'UNATTEMPTED_PERCENTAGE',
        operator: 'GTE',
        threshold: 30,
        severity: 'MEDIUM',
        priority: 3,
        titleTemplate: 'Expand Attempt Coverage',
        recommendationTemplate:
          'Your accuracy on attempted questions was {accuracy}%, but {unattemptedCount} questions were left unattempted ({unattemptedPercentage}%). Consider gradually attempting more moderate questions.',
        isActive: true,
        configVersion: 1,
      },
      {
        id: 'seed-4',
        code: 'TIME_HEAVY',
        name: 'Time Spent on Incorrect Responses',
        category: 'TIME_MANAGEMENT',
        metric: 'TIME_HEAVY_WRONG_COUNT',
        operator: 'GTE',
        threshold: 3,
        severity: 'MEDIUM',
        priority: 4,
        titleTemplate: 'Strategic Skip Implementation',
        recommendationTemplate:
          '{timeHeavyWrongCount} questions consumed significant time and were answered incorrectly. Implement a 90-second decision cut-off.',
        isActive: true,
        configVersion: 1,
      },
    ];
  }
}
