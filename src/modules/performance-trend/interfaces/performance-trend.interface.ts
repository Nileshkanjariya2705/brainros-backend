export type TrendDirection =
  'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';

export interface MockDataPoint {
  attemptId: string;
  examId: string;
  examTitle: string;
  examType: string;
  mockNumber: number;
  label: string; // e.g. "Mock 1"
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  rank: number | null;
  totalCandidates: number | null;
  percentile: number | null;
  timeUsedSeconds: number | null;
  timeUtilizationPercentage: number | null;
}

export interface ScoreTrendPoint {
  attemptId: string;
  label: string;
  date: string;
  score: number;
  maximumScore: number;
  percentage: number;
}

export interface AccuracyTrendPoint {
  attemptId: string;
  label: string;
  date: string;
  accuracy: number;
}

export interface RankTrendPoint {
  attemptId: string;
  label: string;
  date: string;
  rank: number | null;
  totalCandidates: number | null;
  percentile: number | null;
}

export interface PercentileTrendPoint {
  attemptId: string;
  label: string;
  date: string;
  percentile: number | null;
}

export interface TimeTrendPoint {
  attemptId: string;
  label: string;
  date: string;
  timeUsedSeconds: number | null;
  timeUtilizationPercentage: number | null;
  averageTimePerQuestion: number | null;
}

export interface SubjectTrendPoint {
  attemptId: string;
  label: string;
  date: string;
  accuracy: number;
  percentage: number;
  score: number;
  maxScore: number;
}

export interface SubjectTrendSeries {
  subjectId: string;
  subjectName: string;
  points: SubjectTrendPoint[];
}

export interface TrendInsight {
  type: 'POSITIVE' | 'WARNING' | 'NEUTRAL';
  metric: string;
  message: string;
}

export interface TrendSummary {
  totalMocks: number;
  firstMock: MockDataPoint | null;
  latestMock: MockDataPoint | null;
  bestMock: MockDataPoint | null;
  worstMock: MockDataPoint | null;
  scoreDelta: number;
  percentageDelta: number;
  accuracyDelta: number;
  rankDelta: number | null;
  rankImprovement: number | null;
  percentileDelta: number | null;
  timeUsedDeltaSeconds: number | null;
  trendDirections: {
    scoreTrend: TrendDirection;
    accuracyTrend: TrendDirection;
    rankTrend: TrendDirection;
    percentileTrend: TrendDirection;
  };
  mostImprovedSubject?: {
    subjectId: string;
    subjectName: string;
    accuracyDelta: number;
  } | null;
  strongestCurrentSubject?: {
    subjectId: string;
    subjectName: string;
    latestAccuracy: number;
  } | null;
  weakestCurrentSubject?: {
    subjectId: string;
    subjectName: string;
    latestAccuracy: number;
  } | null;
}

export interface PerformanceTrendsResponse {
  summary: TrendSummary;
  mocks: MockDataPoint[];
  scoreTrend: ScoreTrendPoint[];
  accuracyTrend: AccuracyTrendPoint[];
  rankTrend: RankTrendPoint[];
  percentileTrend: PercentileTrendPoint[];
  timeTrend: TimeTrendPoint[];
  subjectTrends: SubjectTrendSeries[];
  trendInsights: TrendInsight[];
}

export interface DirectComparisonResponse {
  mockA: MockDataPoint;
  mockB: MockDataPoint;
  scoreDelta: number;
  accuracyDelta: number;
  percentageDelta: number;
  rankDelta: number | null;
  rankImprovement: number | null;
  percentileDelta: number | null;
  timeDeltaSeconds: number | null;
  subjectDeltas: {
    subjectId: string;
    subjectName: string;
    scoreDelta: number;
    accuracyDelta: number;
  }[];
}
