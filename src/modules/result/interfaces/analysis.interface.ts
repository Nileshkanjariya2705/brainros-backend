export interface PerformanceThresholds {
  excellent: number; // default: 90
  strong: number; // default: 75
  good: number; // default: 60
  weak: number; // default: 40
}

export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  excellent: 90,
  strong: 75,
  good: 60,
  weak: 40,
};

export type PerformanceStatus =
  'EXCELLENT' | 'STRONG' | 'GOOD' | 'WEAK' | 'CRITICAL' | 'NOT_ATTEMPTED';

export interface OverallPerformanceMetrics {
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  totalQuestions: number;
  timeUsedSeconds: number;
  formattedTimeUsed: string;
  averageTimePerQuestionSeconds: number;
  negativeMarksLost: number;
  potentialMarks: number; // score if wrong answers were not attempted
  overallStatus: PerformanceStatus;
  speedAccuracyQuadrant:
    | 'FAST_AND_ACCURATE'
    | 'SLOW_AND_ACCURATE'
    | 'RUSHED_AND_INACCURATE'
    | 'SLOW_AND_STRUGGLING';
}

export interface SubjectAnalyticsItem {
  subjectId: string;
  subjectName: string;
  totalQuestions: number;
  correct: number;
  wrong: number;
  unattempted: number;
  score: number;
  maxScore: number;
  accuracy: number;
  percentage: number;
  timeSpentSeconds: number;
  avgTimePerQuestionSeconds: number;
  status: PerformanceStatus;
  isStrongest: boolean;
  isWeakest: boolean;
}

export interface ChapterAnalyticsItem {
  chapterId: string;
  chapterName: string;
  subjectId: string;
  subjectName: string;
  totalQuestions: number;
  correct: number;
  wrong: number;
  unattempted: number;
  score: number;
  maxScore: number;
  accuracy: number;
  percentage: number;
  timeSpentSeconds: number;
  avgTimePerQuestionSeconds: number;
  status: PerformanceStatus;
}

export interface QuestionTimeExtreme {
  questionId: string;
  examQuestionId: string;
  displayOrder: number;
  timeSeconds: number;
  sectionName: string;
  isCorrect: boolean;
}

export interface SubjectBenchmarkComparison {
  subjectName: string;
  actualSeconds: number;
  recommendedSeconds: number;
  deltaPercent: number;
  observation: string;
}

export interface TimeAnalyticsReport {
  totalExamDurationMinutes: number;
  totalTimeUsedSeconds: number;
  timeRemainingSeconds: number;
  averageTimePerQuestionSeconds: number;
  timeOnCorrectQuestionsSeconds: number;
  avgTimeOnCorrectSeconds: number;
  timeOnWrongQuestionsSeconds: number;
  avgTimeOnWrongSeconds: number;
  timeOnUnattemptedQuestionsSeconds: number;
  avgTimeOnUnattemptedSeconds: number;
  timeWastedSeconds: number;
  fastestQuestion: QuestionTimeExtreme | null;
  slowestQuestion: QuestionTimeExtreme | null;
  pacingMetrics: {
    rushedCount: number; // < 20s
    optimalPaceCount: number;
    overthoughtCount: number; // > 2.5x avg
  };
  subjectTimeDistribution: {
    subjectName: string;
    timeSpentSeconds: number;
    percentageOfTotalTime: number;
  }[];
  subjectBenchmarkComparisons: SubjectBenchmarkComparison[];
}

export interface AttemptStrategyReport {
  negativeMarkingPenalty: number;
  marksLostToGuessing: number;
  scoreWithoutNegativeMarking: number;
  reviewBehavior: {
    markedForReviewCount: number;
    markedAndAnsweredCount: number;
    markedAndCorrectCount: number;
    markedAndWrongCount: number;
  };
  attemptRatio: number; // percentage of exam attempted
  accuracyVsSpeedProfile: string;
  strategicTakeaways: string[];
  overAttemptingWarning: string | null;
  underAttemptingWarning: string | null;
  potentialScoreGainMessage: string;
}

export interface ActionableRecommendation {
  id: string;
  category:
    | 'CHAPTER_REVISION'
    | 'TIME_MANAGEMENT'
    | 'NEGATIVE_MARKING'
    | 'ATTEMPT_STRATEGY';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  impactScore: number; // estimated marks gain
  actionStep: string;
}

export interface FullAnalysisReport {
  attemptId: string;
  examId: string;
  examTitle: string;
  examTargetName: string;
  calculatedAt: Date;
  thresholdsUsed: PerformanceThresholds;
  overall: OverallPerformanceMetrics;
  subjects: {
    items: SubjectAnalyticsItem[];
    strongestSubject: SubjectAnalyticsItem | null;
    weakestSubject: SubjectAnalyticsItem | null;
  };
  chapters: {
    items: ChapterAnalyticsItem[];
    mastered: ChapterAnalyticsItem[];
    revisionNeeded: ChapterAnalyticsItem[];
    criticalFocus: ChapterAnalyticsItem[];
  };
  timeAnalysis: TimeAnalyticsReport;
  attemptStrategy: AttemptStrategyReport;
  recommendations: ActionableRecommendation[];
}
