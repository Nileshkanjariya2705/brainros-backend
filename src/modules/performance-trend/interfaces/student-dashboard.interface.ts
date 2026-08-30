export interface StudentInfo {
  studentId: string;
  studentCode?: string | null;
  name: string;
  class: string;
  examTarget: string;
  preferredLanguage: string;
  email?: string;
  avatar?: string | null;
}

export interface NextExamWidget {
  examId: string;
  title: string;
  examTarget: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  startTime: string | null;
  endTime: string | null;
  status: string;
  canStart: boolean;
  waitSeconds: number;
  accessStatus: string;
  message: string;
}

export interface ActiveAttemptWidget {
  attemptId: string;
  examId: string;
  examTitle: string;
  startedAt: string;
  serverEndTime: string | null;
  timeRemainingSeconds: number;
  currentQuestionNumber: number;
  totalQuestions: number;
  answeredCount: number;
}

export interface PerformanceSummaryWidget {
  latestScore: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  totalAttempts: number;
  timeSpentSeconds: number;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
}

export interface RankSummaryWidget {
  rank: number | null;
  totalCandidates: number | null;
  percentile: number | null;
  stateRank?: number | null;
  categoryRank?: number | null;
}

export interface PredictedRankWidget {
  predictedRankMin: number | null;
  predictedRankMax: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  modelVersion?: string | null;
  isEstimated: boolean;
}

export interface SubjectSummaryItem {
  subjectId: string;
  subjectName: string;
  score: number;
  maxScore: number;
  accuracy: number;
  status: 'EXCELLENT' | 'GOOD' | 'WEAK';
  trendDelta?: number | null; // e.g. +5% from previous mock
}

export interface WeakAreaItem {
  subjectName: string;
  chapterName: string;
  accuracy: number;
  totalQuestions: number;
  status: 'WEAK' | 'NEEDS_FOCUS';
}

export interface DashboardRecommendationItem {
  id: string;
  type: 'WARNING' | 'OPPORTUNITY' | 'STRENGTH' | 'TIP';
  message: string;
  actionLabel?: string;
  actionType?: 'PRACTICE' | 'VIEW_STRATEGY' | 'VIEW_ANALYSIS' | 'VIEW_EXAMS';
  targetUrl?: string;
}

export interface TimeManagementWidget {
  averageTimePerQuestionSeconds: number;
  timeUtilizationPercentage: number;
  totalTimeUsedSeconds: number;
  status: 'OPTIMAL' | 'NEEDS_IMPROVEMENT' | 'SLOW';
}

export interface AttemptStrategyWidget {
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  highRiskAttemptsCount: number;
  avoidableNegativeMarks: number;
  scoreGainOpportunity: number;
}

export interface RecentResultItem {
  attemptId: string;
  examId: string;
  examTitle: string;
  examType: string;
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  rank: number | null;
  totalCandidates: number | null;
  percentile: number | null;
}

export interface StudentDashboardResponse {
  student: StudentInfo;
  nextExam: NextExamWidget | null;
  activeAttempt: ActiveAttemptWidget | null;
  latestPerformance: PerformanceSummaryWidget | null;
  rank: RankSummaryWidget | null;
  predictedRank: PredictedRankWidget | null;
  subjects: SubjectSummaryItem[];
  trendSummary: {
    scoreTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    accuracyTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    rankTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    percentileTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    recentScores: Array<{ mockLabel: string; score: number; accuracy: number; rank: number | null; percentile: number | null }>;
  };
  weakAreas: WeakAreaItem[];
  recommendations: DashboardRecommendationItem[];
  timeManagement: TimeManagementWidget | null;
  attemptStrategy: AttemptStrategyWidget | null;
  recentResults: RecentResultItem[];
  unreadNotificationCount: number;
}
