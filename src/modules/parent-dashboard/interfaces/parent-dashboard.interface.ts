export interface ParentStudentInfo {
  studentId: string;
  name: string;
  studentCode: string;
  grade?: string;
  schoolCollege?: string;
  examTarget?: string;
  state?: string;
  district?: string;
}

export interface ParentStudentOverviewItem {
  studentId: string;
  name: string;
  studentCode: string;
  examTarget?: string;
  latestScore: number;
  latestPercentage: number;
  latestAccuracy: number;
  latestRank: number | null;
  latestPercentile: number | null;
  testsAttempted: number;
  attendancePercentage: number;
  lastTestDate?: string | null;
}

export interface ParentDashboardSummary {
  testsAttempted: number;
  averageScore: number;
  latestScore: number;
  bestScore: number;
  scoreImprovement: number;
  averageAccuracy: number;
  latestAccuracy: number;
  latestRank: number | null;
  latestPercentile: number | null;
  attendancePercentage: number;
}

export interface ParentSubjectSummaryItem {
  subjectId: string;
  name: string;
  score: number;
  maxScore: number;
  accuracy: number;
  percentage: number;
  status: string; // EXCELLENT, STRONG, GOOD, WEAK, CRITICAL
}

export interface ParentSubjectPerformance {
  strongest: {
    subjectId: string;
    name: string;
    accuracy: number;
  } | null;
  weakest: {
    subjectId: string;
    name: string;
    accuracy: number;
  } | null;
  all: ParentSubjectSummaryItem[];
}

export interface ParentAttendanceReport {
  scheduledCount: number;
  attendedCount: number;
  missedCount: number;
  attendancePercentage: number;
}

export interface ParentTimeManagementReport {
  averageTimePerQuestionSeconds: number;
  timeUtilizationPercentage: number;
  highTimeWrongCount: number;
  status: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT';
  observation: string;
}

export interface ParentRankSummary {
  official: {
    rank: number | null;
    totalCandidates: number | null;
    percentile: number | null;
    stateRank?: number | null;
    categoryRank?: number | null;
  };
  predicted?: {
    rankMin: number;
    rankMax: number;
    confidence: string;
    modelVersion: string;
    disclaimer: string;
  } | null;
}

export interface ParentRecommendationItem {
  category: 'SUBJECT' | 'TIME_MANAGEMENT' | 'ACCURACY' | 'CONSISTENCY';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  message: string;
}

export interface ParentRecentTestItem {
  attemptId: string;
  examName: string;
  examType: string;
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  rank: number | null;
  percentile: number | null;
}

export interface RecommendedRevisionItem {
  subjectName: string;
  topicName: string;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedActions: string[];
  estimatedHours: number;
}

export interface ParentTrendPoint {
  attemptId: string;
  examName: string;
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  rank: number | null;
  percentile: number | null;
}

export interface ParentDashboardResponse {
  student: ParentStudentInfo;
  summary: ParentDashboardSummary;
  subjects: ParentSubjectPerformance;
  attendance: ParentAttendanceReport;
  timeManagement: ParentTimeManagementReport;
  rank: ParentRankSummary;
  recommendations: ParentRecommendationItem[];
  recommendedRevisions: RecommendedRevisionItem[];
  trendHistory: ParentTrendPoint[];
  recentTests: ParentRecentTestItem[];
}
