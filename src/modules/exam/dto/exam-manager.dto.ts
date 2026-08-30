import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ExamImportFormatEnum {
  XLSX = 'xlsx',
  CSV = 'csv',
}

export enum ExamImportStatusEnum {
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  READY_TO_IMPORT = 'READY_TO_IMPORT',
  IMPORTING = 'IMPORTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class ExamImportFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

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
  search?: string;
}

export interface ParsedExamPaperRow {
  rowNumber: number;
  examCode: string;
  examName: string;
  examDescription?: string;
  examTarget?: string;
  durationMinutes: number;
  totalMarks?: number;
  subject: string;
  sectionName?: string;
  chapter?: string;
  topic?: string;
  questionNumber?: number;
  questionType?: string;
  questionText: string;
  passageText?: string;
  assertionText?: string;
  reasonText?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  optionE?: string;
  optionF?: string;
  correctAnswer: string;
  marks?: number;
  negativeMarks?: number;
  difficulty?: string;
  explanation?: string;
  language?: string;
}

export interface ExamPaperValidationError {
  row: number;
  column?: string;
  message: string;
}

export interface ExamPaperValidationResult {
  isValid: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  examCount: number;
  examCode: string;
  examTitle: string;
  durationMinutes: number;
  totalMarks: number;
  totalQuestions: number;
  sections: Array<{
    name: string;
    subject: string;
    questionCount: number;
  }>;
  errors: ExamPaperValidationError[];
  warnings: string[];
  validatedRows: Array<{
    rowNumber: number;
    isValid: boolean;
    errors: string[];
    warnings: string[];
    data: ParsedExamPaperRow;
  }>;
}
