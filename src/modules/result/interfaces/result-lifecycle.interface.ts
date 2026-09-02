export const EVALUATION_QUEUE_NAME = 'exam-evaluation';
export const ANALYTICS_QUEUE_NAME = 'exam-analytics';
export const RANKING_QUEUE_NAME = 'exam-ranking';
export const PUBLICATION_QUEUE_NAME = 'exam-publication';
export const RECONCILIATION_QUEUE_NAME = 'result-reconciliation';
export const EXAM_WINDOW_END_QUEUE_NAME = 'exam-window-end';

export enum ResultStatusEnum {
  PENDING_WINDOW_CLOSE = 'PENDING_WINDOW_CLOSE',
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

export enum ResultProcessingStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING_WINDOW_CLOSE = 'PENDING_WINDOW_CLOSE',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ResultPublicationStatus {
  NOT_PUBLISHED = 'NOT_PUBLISHED',
  READY_TO_PUBLISH = 'READY_TO_PUBLISH',
  PUBLISHED = 'PUBLISHED',
  WITHHELD = 'WITHHELD',
}

export enum ReportFileStatus {
  REPORT_NOT_GENERATED = 'REPORT_NOT_GENERATED',
  REPORT_PROCESSING = 'REPORT_PROCESSING',
  REPORT_READY = 'REPORT_READY',
  REPORT_FAILED = 'REPORT_FAILED',
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
  evaluationMode?: 'IMMEDIATE' | 'DEFERRED';
}

export interface ExamWindowEndJobPayload {
  examId: string;
  scheduleId?: string;
  triggeredAt?: string;
  gracePeriodSeconds?: number;
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

export interface ReconciliationJobPayload {
  examId?: string;
  attemptId?: string;
  triggeredAt?: string;
  dryRun?: boolean;
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

export interface ResultStatusResponse {
  processingStatus: ResultProcessingStatus;
  publicationStatus: ResultPublicationStatus;
  resultAvailable: boolean;
  reportAvailable: boolean;
  onlineReportAvailable: boolean;
  pdfReportStatus: ReportFileStatus;
  availability: 'PROCESSING' | 'RESULT_PENDING' | 'RESULT_READY' | 'PUBLISHED' | 'WITHHELD' | 'DISQUALIFIED' | 'FAILED';
  resultStatus: string;
  examType: 'MOCK' | 'LIVE';
  message: string;
  attemptId: string;
  examTitle: string;
  submittedAt: Date | string | null;
  publishedAt?: Date | string | null;
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

export interface AdminAttemptProcessingDetail {
  attemptId: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  examId: string;
  examTitle: string;
  processingStatus: ResultProcessingStatus;
  evaluation: 'COMPLETED' | 'PROCESSING' | 'PENDING' | 'FAILED';
  analytics: 'COMPLETED' | 'PROCESSING' | 'PENDING' | 'FAILED';
  ranking: 'COMPLETED' | 'PROCESSING' | 'PENDING' | 'FAILED';
  publication: ResultPublicationStatus;
  isStuck: boolean;
  submittedAt: string | null;
  lastUpdated: string;
}
