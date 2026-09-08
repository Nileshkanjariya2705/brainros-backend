export type JobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'PAUSED'
  | 'CANCELLED';

export interface JobProgressData {
  current: number;
  total: number;
  percentage: number;
}

export interface JobProgressEventDto {
  event:
    | 'job.queued'
    | 'job.started'
    | 'job.progress'
    | 'job.completed'
    | 'job.failed'
    | 'job.retrying';
  job: {
    queue: string;
    jobId: string;
    type?: string;
    status: JobStatus;
    stage?: string;
    attemptId?: string;
    examId?: string;
    studentId?: string;
    userId?: string;
    institutionId?: string;
    resourceId?: string;
  };
  progress: JobProgressData;
  message?: string;
  stageIndex?: number;
  totalStages?: number;
  errorCode?: string;
  resultSummary?: Record<string, any>;
  timestamp: string;
}

export interface SubscribeJobPayload {
  queue: string;
  jobId: string;
  resourceId?: string;
}
