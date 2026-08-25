export interface ActiveTimingState {
  attemptId: string;
  examQuestionId: string;
  visitNumber: number;
  serverStartedAt: string; // ISO string
  serverRevision: number;
  lastEventId?: string;
  clientTimestamp?: string;
  clientSequence?: number;
  metadata?: any;
}

export interface AuthoritativeTimingResponse {
  attemptId: string;
  examQuestionId: string;
  visitNumber: number;
  serverTime: string;
  serverStartTime: string;
  serverEndTime: string | null;
  timeRemainingSeconds: number;
  isExpired: boolean;
  activeQuestionId: string;
}

export interface ClosedTimingResponse {
  attemptId: string;
  examQuestionId: string;
  visitNumber: number;
  timeSpentSeconds: number;
  serverEndTime: string;
  source: string;
}

export interface QuestionTimingSummary {
  examQuestionId: string;
  questionId: string;
  displayOrder: number;
  subjectId: string;
  subjectName: string;
  chapterId?: string;
  chapterName?: string;
  questionTypeCode?: string;
  difficultyCode?: string;
  visitCount: number;
  totalTimeSpentSeconds: number;
  initialVisitTimeSeconds: number;
  reviewTimeSeconds: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
  answerStatus?: 'CORRECT' | 'WRONG' | 'UNATTEMPTED';
  isMarkedForReview: boolean;
  timeWastedSeconds: number;
}

export interface SubjectTimeSummary {
  subjectId: string;
  subjectName: string;
  questionCount: number;
  timeSpentSeconds: number;
  averageTimePerQuestionSeconds: number;
  timePercentage: number;
  questionPercentage: number;
  allocationDifference: number; // time% - question%
}

export interface ChapterTimeSummary {
  chapterId: string;
  chapterName: string;
  subjectId: string;
  subjectName: string;
  questionCount: number;
  timeSpentSeconds: number;
  averageTimePerQuestionSeconds: number;
  timePercentage: number;
}

export interface CorrectnessTimeSummary {
  outcome: 'CORRECT' | 'WRONG' | 'UNATTEMPTED';
  count: number;
  totalTimeSeconds: number;
  averageTimeSeconds: number;
  percentageOfTime: number;
}

export interface DifficultyTimeSummary {
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'VERY_HARD' | 'UNKNOWN';
  count: number;
  totalTimeSeconds: number;
  averageTimeSeconds: number;
}

export interface QuestionTypeTimeSummary {
  questionType: string;
  count: number;
  totalTimeSeconds: number;
  averageTimeSeconds: number;
}

export interface DetailedTimeAnalysis {
  attemptId: string;
  examId: string;
  examTitle: string;
  analysisVersion: number;
  algorithmVersion: string;
  generatedAt: string;
  totalTimeAvailableSeconds: number;
  totalTimeUsedSeconds: number;
  timeRemainingSeconds: number;
  timeUtilizationPercentage: number;
  averageTimePerQuestionSeconds: number;
  averageTimePerAttemptedQuestionSeconds: number;
  medianTimePerQuestionSeconds: number;
  timeWastedSeconds: number;
  fastestQuestion: QuestionTimingSummary | null;
  slowestQuestion: QuestionTimingSummary | null;
  visitAnalysis: {
    averageVisitsPerQuestion: number;
    questionsVisitedOnce: number;
    questionsVisitedMultipleTimes: number;
    mostVisitedQuestionId: string | null;
    mostVisitedCount: number;
  };
  pacingDistribution: {
    rushedCount: number; // < 15s
    optimalPaceCount: number;
    overthoughtCount: number; // > 2.5x avg
  };
  subjects: SubjectTimeSummary[];
  chapters: ChapterTimeSummary[];
  correctness: CorrectnessTimeSummary[];
  difficulty: DifficultyTimeSummary[];
  questionTypes: QuestionTypeTimeSummary[];
  questions: QuestionTimingSummary[];
}
