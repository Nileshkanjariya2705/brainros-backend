import { Injectable, Logger } from '@nestjs/common';
import {
  StrategyOperator,
  StrategySeverity,
  StrategyRecommendationItem,
  StrategyClassificationCode,
  StrategySummaryMetrics,
  StrategyMetricItem,
  StrategyConfidence,
  StrategyTrend,
  StrategySignal,
  StrategyAction,
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

export interface DecisionEvaluationResult {
  primaryClassification: StrategyClassificationCode;
  confidence: StrategyConfidence;
  confidenceScore: number;
  trend: StrategyTrend;
  whyStatement: string;
  signals: StrategySignal[];
  classifications: StrategyClassificationCode[];
  secondaryClassifications: StrategyClassificationCode[];
  recommendations: StrategyRecommendationItem[];
  actionRecommendation: StrategyAction;
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
   * Multi-Signal Decision Engine: Evaluates behavioral signals, computes confidence,
   * prioritizes primary/secondary issues, and generates personalized explainable recommendations.
   */
  evaluateDecisionEngine(params: {
    rules: StrategyRuleEntity[];
    metrics: StrategySummaryMetrics;
    metricMap: Map<string, StrategyMetricItem>;
    historicalTrend?: StrategyTrend;
    historicalAttemptsCount?: number;
    maxRecommendations?: number;
  }): DecisionEvaluationResult {
    const {
      rules,
      metrics,
      metricMap,
      historicalTrend = 'INSUFFICIENT_HISTORY',
      historicalAttemptsCount = 0,
      maxRecommendations = 5,
    } = params;

    // ── 1. Check Sample Size Protection ──────────────────────────
    if (metrics.sampleSizeLevel === 'INSUFFICIENT') {
      const signals: StrategySignal[] = [
        {
          code: 'SAMPLE_SIZE_LIMIT',
          name: 'Limited Sample Size',
          value: metrics.attemptedCount,
          weight: 'LOW',
          evidence: `Only ${metrics.attemptedCount} questions attempted (${metrics.totalQuestions} in exam).`,
          impact: 'Insufficient data to draw high-confidence strategy conclusions.',
        },
      ];

      const whyStatement =
        'Attempt data is insufficient (less than 5 questions). Complete a full-length mock exam to generate accurate strategic diagnostics.';

      const rec: StrategyRecommendationItem = {
        id: 'rec-insufficient-data',
        ruleCode: 'INSUFFICIENT_DATA',
        category: 'ATTEMPT_COVERAGE',
        title: 'Complete More Mock Tests',
        message:
          'You have attempted very few questions in this session. Complete a comprehensive mock test to unlock AI-powered strategy analysis.',
        severity: 'INFO',
        priority: 1,
        confidence: 'LOW',
        reason: whyStatement,
        evidence: { ...metrics },
        estimatedImpactMarks: 0,
        action: {
          type: 'TIMED_MOCK',
          label: 'Take Full Mock Test',
          targetUrl: '/student/mock-tests',
          description: 'Practice with a full-length exam to calibrate pacing and question selection.',
        },
      };

      return {
        primaryClassification: 'INSUFFICIENT_DATA',
        confidence: 'LOW',
        confidenceScore: 20,
        trend: historicalTrend,
        whyStatement,
        signals,
        classifications: ['INSUFFICIENT_DATA'],
        secondaryClassifications: [],
        recommendations: [rec],
        actionRecommendation: rec.action!,
      };
    }

    // ── 2. Calculate Decision Scores for Each Strategy Candidate ──
    const scores = new Map<StrategyClassificationCode, number>();

    // OVER_ATTEMPTING Score
    let overAttemptScore = 0;
    if (metrics.highRiskAttemptCount >= 3) {
      overAttemptScore += Math.min(40, metrics.highRiskWrongCount * 6);
      if (metrics.highRiskAccuracy < 50) {
        overAttemptScore += 25;
      }
      if (metrics.avoidableNegativeMarks >= 6) {
        overAttemptScore += 20;
      }
      if (historicalTrend === 'DECLINING') {
        overAttemptScore += 15;
      } else if (historicalTrend === 'IMPROVING') {
        // When improving, maintain solid priority so student receives encouraging feedback on their trajectory
        overAttemptScore = Math.max(55, overAttemptScore - 15);
      }
    } else if (metrics.wrongCount >= 8 && metrics.negativeMarksLost >= 8) {
      overAttemptScore += 30;
    }
    scores.set('OVER_ATTEMPTING', Math.min(100, overAttemptScore));

    // UNDER_ATTEMPTING Score
    // Guard: Only valid if accuracy is reasonably high (>= 65%). If accuracy is low, unanswered questions are due to knowledge gap!
    let underAttemptScore = 0;
    if (metrics.accuracy >= 65 && metrics.unattemptedPercentage >= 15) {
      underAttemptScore += 30;
      if (metrics.unusedTimeMinutes >= 10 || metrics.unusedTimePercentage >= 15) {
        underAttemptScore += 35;
      }
      if (metrics.accuracy >= 75) {
        underAttemptScore += 25;
      }
    }
    scores.set('UNDER_ATTEMPTING', Math.min(100, underAttemptScore));

    // TIME_MANAGEMENT Score
    let timeMgmtScore = 0;
    if (metrics.accuracy >= 55) {
      if (metrics.timeHeavyWrongCount >= 3) {
        timeMgmtScore += 35;
      }
      if (metrics.timeHeavyAttemptCount >= 5) {
        timeMgmtScore += 25;
      }
      if (metrics.averageTimePerQuestionSeconds > 90) {
        timeMgmtScore += 25;
      }
    }
    scores.set('TIME_HEAVY', Math.min(100, timeMgmtScore));

    // NEGATIVE_MARKING_HEAVY Score
    let negMarkScore = 0;
    if (metrics.negativeMarksLost > 0) {
      if (metrics.negativeMarksLost >= 10) {
        negMarkScore += 40;
      } else if (metrics.negativeMarksLost >= 5) {
        negMarkScore += 25;
      }
      if (metrics.negativeMarkingImpactPercentage >= 5) {
        negMarkScore += 30;
      }
    }
    scores.set('NEGATIVE_MARKING_HEAVY', Math.min(100, negMarkScore));

    // KNOWLEDGE_GAP Score
    let knowledgeGapScore = 0;
    if (
      metrics.accuracy < 50 &&
      metrics.highRiskAttemptCount <= 3 &&
      metrics.attemptedCount >= 5
    ) {
      knowledgeGapScore = 75;
    }
    scores.set('KNOWLEDGE_GAP', knowledgeGapScore);

    // BALANCED Score
    let balancedScore = 0;
    if (
      metrics.accuracy >= 72 &&
      metrics.attemptedPercentage >= 70 &&
      metrics.avoidableNegativeMarks < 6 &&
      overAttemptScore < 30 &&
      underAttemptScore < 30
    ) {
      balancedScore = 80;
    }
    scores.set('BALANCED', balancedScore);

    // ── 3. Determine Primary and Secondary Classifications ─────────
    const sortedScores = Array.from(scores.entries())
      .filter(([_, score]) => score >= 30)
      .sort((a, b) => b[1] - a[1]);

    let primaryClassification: StrategyClassificationCode = 'BALANCED';
    const secondaryClassifications: StrategyClassificationCode[] = [];

    if (sortedScores.length > 0) {
      primaryClassification = sortedScores[0][0];
      for (let i = 1; i < sortedScores.length; i++) {
        if (sortedScores[i][1] >= 35 && secondaryClassifications.length < 2) {
          secondaryClassifications.push(sortedScores[i][0]);
        }
      }
    }

    // High risk / negative marking classification fallback mapping
    const allClassifications = new Set<StrategyClassificationCode>([
      primaryClassification,
      ...secondaryClassifications,
    ]);

    // ── 4. Calculate Confidence ───────────────────────────────────
    let confNum = 50;
    if (metrics.sampleSizeLevel === 'HIGH') {
      confNum = 90;
    } else if (metrics.sampleSizeLevel === 'MODERATE') {
      confNum = 75;
    } else if (metrics.sampleSizeLevel === 'LOW') {
      confNum = 50;
    }

    if (historicalAttemptsCount >= 2) {
      confNum = Math.min(98, confNum + 8);
    }

    const topScore = sortedScores[0]?.[1] || 50;
    const secondScore = sortedScores[1]?.[1] || 0;
    if (topScore - secondScore >= 25) {
      confNum = Math.min(98, confNum + 7);
    }

    const confidence: StrategyConfidence =
      confNum >= 75 ? 'HIGH' : confNum >= 50 ? 'MEDIUM' : 'LOW';

    // ── 5. Extract Structured Evidence Signals ────────────────────
    const signals: StrategySignal[] = [];

    if (metrics.highRiskAttemptCount > 0) {
      signals.push({
        code: 'HIGH_RISK_ATTEMPTS',
        name: 'High-Risk Question Attempts',
        value: metrics.highRiskAttemptCount,
        weight: metrics.highRiskWrongCount >= 4 ? 'HIGH' : 'MEDIUM',
        evidence: `${metrics.highRiskAttemptCount} difficult/high-penalty questions attempted, ${metrics.highRiskWrongCount} answered incorrectly (${metrics.highRiskAccuracy}% accuracy).`,
        impact:
          metrics.avoidableNegativeMarks > 0
            ? `−${metrics.avoidableNegativeMarks} avoidable negative marks lost`
            : undefined,
      });
    }

    if (metrics.negativeMarksLost > 0) {
      signals.push({
        code: 'NEGATIVE_MARK_LOSS',
        name: 'Negative Marking Penalty',
        value: `−${metrics.negativeMarksLost} marks`,
        weight: metrics.negativeMarksLost >= 8 ? 'HIGH' : 'MEDIUM',
        evidence: `Negative marking deducted ${metrics.negativeMarksLost} marks across ${metrics.wrongCount} incorrect answers.`,
        impact: `${metrics.negativeMarkingImpactPercentage}% of maximum exam marks lost`,
      });
    }

    if (metrics.unusedTimeMinutes >= 5) {
      signals.push({
        code: 'UNUSED_TIME',
        name: 'Unused Exam Time',
        value: `${metrics.unusedTimeMinutes} mins`,
        weight: metrics.unusedTimeMinutes >= 15 ? 'HIGH' : 'MEDIUM',
        evidence: `${metrics.unusedTimeMinutes} minutes remained unused upon submission (${metrics.unusedTimePercentage}% of allotted time).`,
        impact:
          metrics.unattemptedCount > 0
            ? `${metrics.unattemptedCount} questions left unattempted despite surplus time`
            : undefined,
      });
    }

    if (metrics.timeHeavyWrongCount > 0) {
      signals.push({
        code: 'TIME_HEAVY_ERRORS',
        name: 'Time-Heavy Errors',
        value: metrics.timeHeavyWrongCount,
        weight: metrics.timeHeavyWrongCount >= 3 ? 'HIGH' : 'MEDIUM',
        evidence: `${metrics.timeHeavyWrongCount} questions consumed >1.5x expected benchmark time and resulted in incorrect answers.`,
      });
    }

    signals.push({
      code: 'ATTEMPT_ACCURACY',
      name: 'Attempt vs Accuracy Ratio',
      value: `${metrics.accuracy}%`,
      weight: 'INFO',
      evidence: `${metrics.correctCount} correct out of ${metrics.attemptedCount} attempted (${metrics.attemptedPercentage}% exam coverage).`,
    });

    // ── 6. Build Why Statement & Primary Recommendation ───────────
    const { whyStatement, recommendations, actionRecommendation } =
      this.generatePersonalizedRecommendations({
        primary: primaryClassification,
        secondary: secondaryClassifications,
        metrics,
        confidence,
        trend: historicalTrend,
        rules,
        maxRecommendations,
      });

    return {
      primaryClassification,
      confidence,
      confidenceScore: confNum,
      trend: historicalTrend,
      whyStatement,
      signals,
      classifications: Array.from(allClassifications),
      secondaryClassifications,
      recommendations,
      actionRecommendation,
    };
  }

  /**
   * Personalized Recommendation Generator with dynamic subject/chapter insights & action links
   */
  private generatePersonalizedRecommendations(params: {
    primary: StrategyClassificationCode;
    secondary: StrategyClassificationCode[];
    metrics: StrategySummaryMetrics;
    confidence: StrategyConfidence;
    trend: StrategyTrend;
    rules: StrategyRuleEntity[];
    maxRecommendations: number;
  }): {
    whyStatement: string;
    recommendations: StrategyRecommendationItem[];
    actionRecommendation: StrategyAction;
  } {
    const { primary, secondary, metrics, confidence, trend, maxRecommendations } =
      params;
    const recs: StrategyRecommendationItem[] = [];

    // Find weakest subject concentration for personalized coaching
    let weakSubjectHighlight = '';
    if (metrics.subjectWeaknessMap) {
      const subjectsWithLoss = Object.values(metrics.subjectWeaknessMap).sort(
        (a, b) => b.avoidableLoss - a.avoidableLoss,
      );
      if (subjectsWithLoss.length > 0 && subjectsWithLoss[0].avoidableLoss > 0) {
        weakSubjectHighlight = ` Most of these losses occurred in ${subjectsWithLoss[0].subjectName} (${subjectsWithLoss[0].highRiskWrong} incorrect attempts).`;
      }
    }

    let whyStatement = '';
    let primaryAction: StrategyAction = {
      type: 'STRATEGY_ANALYSIS',
      label: 'Inspect Question Review',
      targetUrl: `/exam/result/${metrics.totalQuestions}`,
    };

    switch (primary) {
      case 'OVER_ATTEMPTING':
      case 'HIGH_RISK_ATTEMPTING': {
        if (trend === 'IMPROVING') {
          whyStatement = `Your high-risk attempts have decreased significantly. You attempted ${metrics.highRiskAttemptCount} risky questions with ${metrics.avoidableNegativeMarks} marks avoidable loss, showing clear improvement in question selectivity.`;
        } else {
          whyStatement = `You attempted ${metrics.highRiskAttemptCount} high-risk questions and ${metrics.highRiskWrongCount} were incorrect, causing approximately ${metrics.avoidableNegativeMarks} marks of negative impact.${weakSubjectHighlight}`;
        }

        primaryAction = {
          type: 'STRATEGY_ANALYSIS',
          label: 'Practice Question Selection',
          targetUrl: '/student/mock-tests',
          description: 'Take targeted sectional mocks to practice skipping low-probability questions.',
        };

        recs.push({
          id: 'rec-over-attempting',
          ruleCode: 'OVER_ATTEMPTING',
          category: 'RISK',
          title:
            trend === 'IMPROVING'
              ? 'Maintain High Question Selectivity'
              : 'Reduce High-Risk Question Attempts',
          message:
            trend === 'IMPROVING'
              ? `Your risky attempts dropped. Continue prioritizing high-confidence questions to preserve marks.`
              : `Your score could improve by approximately ${metrics.avoidableNegativeMarks} marks by skipping low-probability hard questions.${weakSubjectHighlight}`,
          severity: 'HIGH',
          priority: 1,
          confidence,
          reason: whyStatement,
          evidence: {
            highRiskAttemptCount: metrics.highRiskAttemptCount,
            highRiskWrongCount: metrics.highRiskWrongCount,
            avoidableNegativeMarks: metrics.avoidableNegativeMarks,
          },
          estimatedImpactMarks: metrics.avoidableNegativeMarks,
          action: primaryAction,
        });
        break;
      }

      case 'UNDER_ATTEMPTING': {
        whyStatement = `You achieved a high accuracy of ${metrics.accuracy}%, but left ${metrics.unattemptedCount} questions unattempted (${metrics.unattemptedPercentage}%) with ${metrics.unusedTimeMinutes} minutes of unused time.`;

        primaryAction = {
          type: 'TIMED_MOCK',
          label: 'Expand Attempt Coverage',
          targetUrl: '/student/mock-tests',
          description: 'Take timed mock tests to build confidence in attempting moderate difficulty questions.',
        };

        recs.push({
          id: 'rec-under-attempting',
          ruleCode: 'UNDER_ATTEMPTING',
          category: 'ATTEMPT_COVERAGE',
          title: 'Expand Attempt Coverage on Moderate Questions',
          message: `Your high accuracy (${metrics.accuracy}%) indicates strong topic grasp. With ${metrics.unusedTimeMinutes} minutes left over, attempting 5–8 more moderate questions could significantly raise your percentile.`,
          severity: 'MEDIUM',
          priority: 1,
          confidence,
          reason: whyStatement,
          evidence: {
            accuracy: metrics.accuracy,
            unattemptedCount: metrics.unattemptedCount,
            unusedTimeMinutes: metrics.unusedTimeMinutes,
          },
          estimatedImpactMarks: Math.round(metrics.unattemptedCount * 0.4 * 4),
          action: primaryAction,
        });
        break;
      }

      case 'TIME_HEAVY': {
        whyStatement = `You spent excessive time on ${metrics.timeHeavyWrongCount} incorrect questions (averaging ${metrics.averageTimePerQuestionSeconds}s per question) despite having solid accuracy on faster questions.`;

        primaryAction = {
          type: 'TIMED_MOCK',
          label: 'Practice Speed Drills',
          targetUrl: '/student/mock-tests',
          description: 'Set strict 90-second decision cut-offs to avoid getting bogged down on complex questions.',
        };

        recs.push({
          id: 'rec-time-heavy',
          ruleCode: 'TIME_HEAVY',
          category: 'TIME_MANAGEMENT',
          title: 'Implement 90-Second Skip Protocol',
          message: `${metrics.timeHeavyWrongCount} questions consumed significant time and were ultimately answered incorrectly. Adopt a strict 90-second cut-off to save precious exam time.`,
          severity: 'MEDIUM',
          priority: 1,
          confidence,
          reason: whyStatement,
          evidence: {
            timeHeavyWrongCount: metrics.timeHeavyWrongCount,
            averageTimePerQuestionSeconds: metrics.averageTimePerQuestionSeconds,
          },
          estimatedImpactMarks: metrics.avoidableNegativeMarks,
          action: primaryAction,
        });
        break;
      }

      case 'NEGATIVE_MARKING_HEAVY': {
        whyStatement = `Negative marking deducted ${metrics.negativeMarksLost} marks across ${metrics.wrongCount} incorrect answers, reducing your total score by ${metrics.negativeMarkingImpactPercentage}%.`;

        primaryAction = {
          type: 'STRATEGY_PRACTICE',
          label: 'Negative Marking Reduction Practice',
          targetUrl: '/student/mock-tests',
          description: 'Focus on eliminating blind guesses to preserve net marks.',
        };

        recs.push({
          id: 'rec-negative-marking',
          ruleCode: 'NEGATIVE_MARKING_HEAVY',
          category: 'NEGATIVE_MARKING',
          title: 'Calibrate Guessing and Eliminate Penalties',
          message: `Eliminating low-probability guesses could restore up to ${metrics.negativeMarksLost} marks to your net score.`,
          severity: 'HIGH',
          priority: 1,
          confidence,
          reason: whyStatement,
          evidence: {
            negativeMarksLost: metrics.negativeMarksLost,
            wrongCount: metrics.wrongCount,
          },
          estimatedImpactMarks: metrics.negativeMarksLost,
          action: primaryAction,
        });
        break;
      }

      case 'KNOWLEDGE_GAP': {
        whyStatement = `Your overall accuracy was ${metrics.accuracy}% across standard difficulty questions. This indicates foundational concepts revision priorities rather than an attempt selection strategy defect.`;

        primaryAction = {
          type: 'CHAPTER_PRACTICE',
          label: 'Review Weak Chapters',
          targetUrl: '/student/mock-tests',
          description: 'Focus on foundational chapter practice to reinforce core concepts before speed testing.',
        };

        recs.push({
          id: 'rec-knowledge-gap',
          ruleCode: 'KNOWLEDGE_GAP',
          category: 'KNOWLEDGE_DIAGNOSTIC',
          title: 'Focus on Foundational Revision',
          message: `Accuracy on core questions was ${metrics.accuracy}%. Focus revision on foundational concepts rather than altering your attempt strategy.`,
          severity: 'HIGH',
          priority: 1,
          confidence,
          reason: whyStatement,
          evidence: {
            accuracy: metrics.accuracy,
            wrongCount: metrics.wrongCount,
          },
          estimatedImpactMarks: 0,
          action: primaryAction,
        });
        break;
      }

      case 'BALANCED':
      default: {
        whyStatement = `You demonstrated a well-balanced attempt strategy with ${metrics.attemptedPercentage}% exam coverage, ${metrics.accuracy}% accuracy, and strictly controlled negative mark penalties.`;

        primaryAction = {
          type: 'TIMED_MOCK',
          label: 'Continue Full-Length Mocks',
          targetUrl: '/student/mock-tests',
          description: 'Maintain this balanced attempt strategy in upcoming full-length assessments.',
        };

        recs.push({
          id: 'rec-balanced',
          ruleCode: 'BALANCED',
          category: 'ATTEMPT_COVERAGE',
          title: 'Balanced Exam Strategy',
          message: `Excellent balance between coverage (${metrics.attemptedPercentage}%) and accuracy (${metrics.accuracy}%). Continue this question selection discipline.`,
          severity: 'INFO',
          priority: 1,
          confidence,
          reason: whyStatement,
          evidence: { ...metrics },
          estimatedImpactMarks: 0,
          action: primaryAction,
        });
        break;
      }
    }

    // Secondary recommendations for multi-issue situations
    for (const sec of secondary) {
      if (recs.length >= maxRecommendations) break;
      if (sec === 'TIME_HEAVY' && primary !== 'TIME_HEAVY') {
        recs.push({
          id: 'rec-secondary-time',
          ruleCode: 'TIME_HEAVY',
          category: 'TIME_MANAGEMENT',
          title: 'Secondary: Optimize Decision Pacing',
          message: `In addition to your primary focus, avoid spending >90 seconds on uncertain questions (${metrics.timeHeavyWrongCount} time-heavy errors).`,
          severity: 'MEDIUM',
          priority: 2,
          confidence,
          reason: 'Time management is a secondary contributor to avoidable score loss.',
          evidence: { timeHeavyWrongCount: metrics.timeHeavyWrongCount },
          estimatedImpactMarks: 0,
        });
      } else if (sec === 'NEGATIVE_MARKING_HEAVY' && primary !== 'NEGATIVE_MARKING_HEAVY') {
        recs.push({
          id: 'rec-secondary-neg',
          ruleCode: 'NEGATIVE_MARKING_HEAVY',
          category: 'NEGATIVE_MARKING',
          title: 'Secondary: Control Negative Mark Penalties',
          message: `Negative marking cost you ${metrics.negativeMarksLost} marks across ${metrics.wrongCount} errors.`,
          severity: 'MEDIUM',
          priority: 2,
          confidence,
          reason: 'Negative marking penalty reduction will complement your primary strategy fix.',
          evidence: { negativeMarksLost: metrics.negativeMarksLost },
          estimatedImpactMarks: metrics.negativeMarksLost,
        });
      }
    }

    return { whyStatement, recommendations: recs, actionRecommendation: primaryAction };
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
        threshold: 10,
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
        threshold: 25,
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
