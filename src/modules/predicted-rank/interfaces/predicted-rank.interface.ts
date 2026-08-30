export type PredictionStatusEnum =
  'PENDING' | 'PROCESSING' | 'COMPLETED' | 'UNAVAILABLE' | 'FAILED';

export type DataQualityStatusEnum =
  'PENDING_VALIDATION' | 'VALID' | 'INVALID' | 'PARTIALLY_VALID' | 'ARCHIVED';

export interface PredictionInput {
  attemptId: string;
  studentId: string;
  score: number;
  totalMarks: number;
  examType: string;
  examVersionId?: string;
  examTitle?: string;
}

export interface PredictionOutput {
  status: PredictionStatusEnum;
  unavailableReason?: string;
  inputScore: number;
  normalizedScore: number;
  predictedRank?: number;
  predictedRankMin?: number;
  predictedRankMax?: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore?: number;
  percentileEstimate?: number;
  historicalExamCount: number;
  datasetSize: number;
  modelCode: string;
  modelVersion: string;
  configVersion: number;
  datasetVersion: number;
  explanation?: Record<string, any>;
}

export interface RankPredictionModel {
  predict(
    input: PredictionInput,
    historicalDatasets: SelectedHistoricalDataset[],
  ): PredictionOutput;
}

export interface SelectedHistoricalDataset {
  historicalExamId: string;
  examName: string;
  examType: string;
  totalMarks: number;
  totalCandidates: number;
  weight: number;
  scoreRanges: {
    minScore: number;
    maxScore: number;
    representativeScore: number;
    minRank: number;
    maxRank: number;
    candidateCount: number;
  }[];
}

export interface DatasetQualityReport {
  historicalExamId: string;
  status: DataQualityStatusEnum;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  minScore: number;
  maxScore: number;
  isMonotonic: boolean;
  scoreCoveragePercentage: number;
  qualityScore: number;
  issues: string[];
}

export interface ModelAccuracySummary {
  modelCode: string;
  modelVersion: string;
  totalEvaluations: number;
  meanAbsoluteError: number;
  medianAbsoluteError: number;
  meanRelativeError: number;
  rangeCoveragePercentage: number;
  withinRangeCount: number;
}
