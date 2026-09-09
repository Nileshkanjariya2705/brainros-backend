export type RecommendationType =
  | 'WEAK_CHAPTER'
  | 'WEAK_SUBJECT'
  | 'DECLINING_SUBJECT'
  | 'IMPROVEMENT_TREND'
  | 'TIME_MANAGEMENT'
  | 'NEGATIVE_MARKING'
  | 'OVER_ATTEMPTING'
  | 'UNDER_ATTEMPTING'
  | 'STRONG_SUBJECT'
  | 'PRACTICE_RECOMMENDATION';

export type RecommendationPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'STRENGTH';

export type RecommendationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RecommendationAction {
  type: 'PRACTICE_MOCK' | 'VIEW_STRATEGY' | 'VIEW_ANALYSIS' | 'REVIEW_CONCEPTS';
  label: string;
  targetUrl: string | null;
  mockTestId?: string | null;
  mockTestTitle?: string | null;
}

export interface PersonalizedRecommendation {
  id: string;
  type: RecommendationType;
  priority: RecommendationPriority;
  priorityScore: number;
  confidence: RecommendationConfidence;
  title: string;
  message: string;
  reason: string;
  subjectId?: string | null;
  subjectName?: string | null;
  chapterId?: string | null;
  chapterName?: string | null;
  metrics?: {
    accuracy?: number;
    sampleSize?: number;
    wrongCount?: number;
    unattemptedCount?: number;
    avgTimeSeconds?: number;
    negativeMarksLost?: number;
    trendDelta?: number;
    potentialScoreGain?: number;
  };
  action: RecommendationAction;
}

export interface RecommendationEngineOptions {
  lookbackAttempts?: number; // default 5
  minChapterQuestionsForHighConfidence?: number; // default 5
  minChapterQuestionsForAnalysis?: number; // default 2
  weakAccuracyThreshold?: number; // default 55%
  criticalAccuracyThreshold?: number; // default 40%
  strongAccuracyThreshold?: number; // default 80%
  maxRecommendations?: number; // default 5
}
