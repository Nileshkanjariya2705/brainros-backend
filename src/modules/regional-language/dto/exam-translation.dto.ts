import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ExamTranslationExportFormat {
  XLSX = 'xlsx',
  CSV = 'csv',
}

export class ExamTranslationQueryDto {
  @IsNotEmpty()
  @IsString()
  languageId: string;

  @IsOptional()
  @IsEnum(ExamTranslationExportFormat)
  format?: ExamTranslationExportFormat = ExamTranslationExportFormat.XLSX;
}

export class ImportExamTranslationDto {
  @IsNotEmpty()
  @IsString()
  languageId: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  replaceMode?: boolean = false;
}

export class ExamTranslationTargetsQueryDto {
  @IsOptional()
  @IsEnum(['ALL', 'LIVE_EXAM', 'MOCK', 'SUBJECT_MOCK'])
  type?: 'ALL' | 'LIVE_EXAM' | 'MOCK' | 'SUBJECT_MOCK';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'title' | 'totalQuestions' = 'createdAt';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export interface TranslationTargetItem {
  id: string;
  title: string;
  type: 'LIVE_EXAM' | 'MOCK' | 'SUBJECT_MOCK';
  typeLabel: string;
  subject: {
    id: string;
    name: string;
    code?: string | null;
  } | null;
  subjectsSummary: string;
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  status: string;
  createdAt: string; // Authoritative DB createdAt (ISO 8601)
  updatedAt: string;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  translationCoverage: Record<string, number>; // e.g. { EN: 100, HI: 85, GU: 60 }
  languagesCount: number;
  overallCoveragePercentage: number;
  isAllRequiredComplete: boolean;
  isLocked: boolean;
}

export interface TranslationTargetsResponse {
  items: TranslationTargetItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ExamLanguageCoverageItem {
  languageId: string;
  languageCode: string;
  languageName: string;
  nativeName: string;
  isDefault: boolean;
  totalQuestions: number;
  translatedQuestions: number;
  questionCoveragePercentage: number;
  totalOptions: number;
  translatedOptions: number;
  optionCoveragePercentage: number;
  overallCoveragePercentage: number;
  status:
    | 'NOT_ADDED'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'FAILED'
    | 'IN_PROGRESS'
    | 'COMPLETE'
    | 'NOT_STARTED';
  missingQuestionsCount: number;
  missingQuestionIds: string[];
  lastUpdatedAt?: string | null;
  jobId?: string;
  processingError?: string | null;
}

export interface ExamTranslationCoverageResponse {
  examId: string;
  examTitle: string;
  totalQuestions: number;
  totalOptions: number;
  languages: ExamLanguageCoverageItem[];
  overallCompletenessPercentage: number;
  isAllRequiredComplete: boolean;
}

export interface ExamTranslationRowDiff {
  rowNumber: number;
  questionId: string;
  questionText: string;
  action: 'NEW' | 'UPDATE' | 'UNCHANGED' | 'INVALID';
  translatedOptionsCount: number;
  totalOptionsCount: number;
  errors: string[];
}

export interface ExamTranslationValidationResponse {
  examId: string;
  languageId: string;
  languageName: string;
  languageCode: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  newTranslationsCount: number;
  updatedTranslationsCount: number;
  unchangedTranslationsCount: number;
  missingExamQuestionsCount: number;
  coverageAfterImportPercentage: number;
  rowDetails: ExamTranslationRowDiff[];
  errors: string[];
}
