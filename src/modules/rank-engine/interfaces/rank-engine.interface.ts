export type RankTypeEnum =
  | 'OVERALL'
  | 'STATE'
  | 'DISTRICT'
  | 'SCHOOL'
  | 'COLLEGE'
  | 'INSTITUTION'
  | 'CATEGORY';

export type RankSnapshotStatusEnum =
  | 'PENDING'
  | 'PROCESSING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED';

export interface CandidateRankInput {
  attemptId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  negativeMarksLost: number;
  timeUsedSeconds: number;
  state?: string | null;
  district?: string | null;
  schoolCollege?: string | null;
  category?: string | null;
}

export interface CalculatedRankItem {
  attemptId: string;
  studentId: string;
  rankType: RankTypeEnum;
  scopeId?: string | null;
  scopeName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  rank: number;
  totalCandidates: number;
  percentile: number;
  score: number;
  accuracy: number;
  timeUsedSeconds?: number;
  predictedRankMin?: number | null;
  predictedRankMax?: number | null;
  predictionConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  predictionModelVersion?: string | null;
}

export interface ScopedRankSummary {
  type: RankTypeEnum;
  scopeName?: string;
  rank: number;
  totalCandidates: number;
  percentile: number;
  score: number;
  accuracy: number;
}

export interface MyRanksResponse {
  attemptId: string;
  examId: string;
  examTitle: string;
  status: 'RANK_READY' | 'RANK_PENDING' | 'RANK_PROCESSING';
  snapshotVersion: number;
  generatedAt?: string;
  overall: ScopedRankSummary;
  state?: ScopedRankSummary;
  district?: ScopedRankSummary;
  school?: ScopedRankSummary;
  college?: ScopedRankSummary;
  category?: ScopedRankSummary;
  predictedRank?: {
    predictedRankMin: number;
    predictedRankMax: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    modelVersion: string;
    disclaimer: string;
  } | null;
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  studentName: string;
  studentCode: string;
  score: number;
  percentage: number;
  accuracy: number;
  timeUsedSeconds: number;
  percentile: number;
  state?: string;
  district?: string;
  schoolCollege?: string;
}

export interface AdminLeaderboardResponse {
  examId: string;
  examTitle: string;
  rankType: RankTypeEnum;
  scopeName?: string;
  snapshotVersion: number;
  totalCandidates: number;
  page: number;
  limit: number;
  totalPages: number;
  items: LeaderboardEntry[];
}
