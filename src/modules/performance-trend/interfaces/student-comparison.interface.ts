export interface ComparisonAttemptItem {
  attemptId: string;
  examId: string;
  examName: string;
  examType: string;
  date: string;
  score: number;
  maximumScore: number;
  percentage: number;
  accuracy: number;
  rank: number | null;
  totalCandidates: number | null;
  percentile: number | null;
  timeUsedSeconds: number | null;
  averageTimePerQuestionSeconds: number | null;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  status: string;
}

export interface ComparisonSummary {
  totalAttempts: number;
  first: {
    attemptId: string;
    label: string;
    date: string;
    score: number;
    maximumScore: number;
    percentage: number;
    accuracy: number;
    rank: number | null;
    percentile: number | null;
    timeUsedSeconds: number | null;
  } | null;
  latest: {
    attemptId: string;
    label: string;
    date: string;
    score: number;
    maximumScore: number;
    percentage: number;
    accuracy: number;
    rank: number | null;
    percentile: number | null;
    timeUsedSeconds: number | null;
  } | null;
  best: {
    attemptId: string;
    label: string;
    score: number;
    percentage: number;
    accuracy: number;
    rank: number | null;
    percentile: number | null;
  } | null;
  scoreDelta: number;
  percentageDelta: number;
  accuracyDelta: number;
  rankDelta: number | null;
  rankImprovement: number | null;
  percentileDelta: number | null;
  timeUsedDeltaSeconds: number | null;
  trendDirections: {
    scoreTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    accuracyTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    rankTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
    percentileTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
  };
}

export interface SubjectComparisonRow {
  subjectId: string;
  subjectName: string;
  mockAccuracies: Record<string, number>; // attemptId or label -> accuracy %
  mockScores: Record<string, number>;     // attemptId or label -> score
  trendDelta?: number;                   // latest - first accuracy
}

export interface DetailedComparisonResponse {
  summary: ComparisonSummary;
  attempts: ComparisonAttemptItem[];
  scoreTrend: Array<{
    attemptId: string;
    label: string;
    date: string;
    score: number;
    maxScore: number;
    percentage: number;
  }>;
  accuracyTrend: Array<{
    attemptId: string;
    label: string;
    date: string;
    accuracy: number;
  }>;
  rankTrend: Array<{
    attemptId: string;
    label: string;
    date: string;
    rank: number | null;
    totalCandidates: number | null;
    percentile: number | null;
  }>;
  percentileTrend: Array<{
    attemptId: string;
    label: string;
    date: string;
    percentile: number | null;
  }>;
  timeTrend: Array<{
    attemptId: string;
    label: string;
    date: string;
    timeUsedMinutes: number | null;
    averageTimePerQuestionSeconds: number | null;
  }>;
  subjectComparison: SubjectComparisonRow[];
  subjectTrends: Array<{
    subjectId: string;
    subjectName: string;
    data: Array<{
      mockLabel: string;
      accuracy: number;
      score: number;
    }>;
  }>;
  insights: string[];
}
