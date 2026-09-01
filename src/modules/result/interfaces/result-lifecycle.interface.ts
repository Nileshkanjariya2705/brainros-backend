export const EVALUATION_QUEUE_NAME = 'exam-evaluation';
export const ANALYTICS_QUEUE_NAME = 'exam-analytics';
export const RANKING_QUEUE_NAME = 'exam-ranking';
export const PUBLICATION_QUEUE_NAME = 'exam-publication';

export enum ResultStatusEnum {
  PROCESSING = 'PROCESSING',
  EVALUATED = 'EVALUATED',
  ANALYTICS_PROCESSING = 'ANALYTICS_PROCESSING',
  RANKING_PROCESSING = 'RANKING_PROCESSING',
  READY = 'READY',
  READY_TO_PUBLISH = 'READY_TO_PUBLISH',
  PUBLISHED = 'PUBLISHED',
  WITHHELD = 'WITHHELD',
  DISQUALIFIED = 'DISQUALIFIED',
  FAILED = 'FAILED',
}

export enum ExamPublicationStatusEnum {
  NOT_READY = 'NOT_READY',
  PROCESSING = 'PROCESSING',
  READY_TO_PUBLISH = 'READY_TO_PUBLISH',
  PUBLISHED = 'PUBLISHED',
  WITHHELD = 'WITHHELD',
}

export interface EvaluationJobPayload {
  attemptId: string;
  evaluationVersion?: number;
  triggeredAt?: string;
  retryCount?: number;
}

export interface AnalyticsJobPayload {
  attemptId: string;
  triggeredAt?: string;
  retryCount?: number;
}

export interface RankingJobPayload {
  examId: string;
  attemptId?: string;
  isMock?: boolean;
  snapshotVersion?: number;
  triggeredAt?: string;
  retryCount?: number;
}

export interface ExamPublicationJobPayload {
  examId: string;
  publicationVersion: number;
  publishedById: string;
  publishedAt: string;
}

export interface BulkResultNotificationJobPayload {
  examId: string;
  publicationVersion: number;
  studentId: string;
  studentName?: string;
  studentEmail?: string;
  studentPhone?: string;
  attemptId: string;
  score: number;
  maxScore: number;
  percentage: number;
  rank?: number;
  totalCandidates?: number;
  percentile?: number;
}

export interface ResultReadinessResponse {
  ready: boolean;
  examId: string;
  examTitle: string;
  examType: 'MOCK' | 'LIVE';
  publicationStatus: string;
  totalEligibleAttempts: number;
  finalizedAttempts: number;
  evaluatedAttempts: number;
  analyticsCompletedAttempts: number;
  rankingCompleted: boolean;
  securityReviewCompleted: boolean;
  flaggedAttempts: number;
  disqualifiedAttempts: number;
  pendingEvaluationAttempts: number;
  reason: string | null;
  checkedAt: string;
}

export interface StudentResultVisibilityResponse {
  availability: 'PROCESSING' | 'RESULT_PENDING' | 'RESULT_READY' | 'PUBLISHED' | 'WITHHELD' | 'DISQUALIFIED' | 'FAILED';
  resultStatus: string;
  examType: 'MOCK' | 'LIVE';
  message: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  submittedAt: string | null;
  publishedAt?: string | null;
  result?: any;
}
