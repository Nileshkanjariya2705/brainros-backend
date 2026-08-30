export type StrategyCategory =
  | 'ATTEMPT_COVERAGE'
  | 'RISK'
  | 'NEGATIVE_MARKING'
  | 'TIME_MANAGEMENT'
  | 'QUESTION_SELECTION'
  | 'REVIEW_BEHAVIOR'
  | 'SCORE_IMPROVEMENT';

export type StrategyOperator =
  'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'BETWEEN' | 'PERCENT_GT' | 'PERCENT_LT';

export type StrategySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type StrategyClassificationCode =
  | 'BALANCED'
  | 'OVER_ATTEMPTING'
  | 'UNDER_ATTEMPTING'
  | 'HIGH_RISK_ATTEMPTING'
  | 'TIME_HEAVY'
  | 'NEGATIVE_MARKING_HEAVY';

export interface StrategyMetricItem {
  metricCode: string;
  value: number;
  unit: 'COUNT' | 'PERCENTAGE' | 'MARKS' | 'SECONDS' | 'RATIO';
  targetType?: 'EXAM' | 'SUBJECT' | 'CHAPTER' | 'QUESTION';
  targetId?: string;
  metadata?: Record<string, any>;
}

export interface StrategyEvidence {
  attemptedCount: number;
  attemptedPercentage: number;
  wrongCount: number;
  accuracy: number;
  highRiskAttemptCount: number;
  highRiskWrongCount: number;
  negativeMarksLost: number;
  avoidableNegativeMarks: number;
  timeHeavyWrongCount: number;
  reviewedQuestionCount: number;
  reviewedCorrectCount: number;
  [key: string]: any;
}

export interface StrategyRecommendationItem {
  id: string;
  ruleCode: string;
  category: StrategyCategory;
  title: string;
  message: string;
  severity: StrategySeverity;
  priority: number;
  targetType?: 'EXAM' | 'SUBJECT' | 'CHAPTER';
  targetId?: string;
  evidence: Record<string, any>;
  estimatedImpactMarks: number;
}

export interface StrategySummaryMetrics {
  totalQuestions: number;
  attemptedCount: number;
  attemptedPercentage: number;
  unattemptedCount: number;
  unattemptedPercentage: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number;
  highRiskAttemptCount: number;
  highRiskWrongCount: number;
  highRiskAccuracy: number;
  negativeMarksLost: number;
  avoidableNegativeMarks: number;
  negativeMarkingImpactPercentage: number;
  timeHeavyWrongCount: number;
  timeHeavyAttemptCount: number;
  reviewedQuestionCount: number;
  reviewedCorrectCount: number;
  reviewedWrongCount: number;
  projectedImprovementMarks: number;
  projectedScore: number;
  actualObtainedMarks: number;
  maxScore: number;
}

export interface DetailedStrategyAnalysis {
  attemptId: string;
  examId: string;
  examTitle: string;
  strategyVersion: number;
  algorithmVersion: string;
  generatedAt: string;
  primaryClassification: StrategyClassificationCode;
  classifications: StrategyClassificationCode[];
  metrics: StrategySummaryMetrics;
  recommendations: StrategyRecommendationItem[];
  projectedImprovement: {
    estimatedAvoidableLossMarks: number;
    projectedScore: number;
    actualScore: number;
    disclaimer: string;
  };
}
