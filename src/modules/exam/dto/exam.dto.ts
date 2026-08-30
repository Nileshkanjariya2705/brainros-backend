import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Exam Section Definition ───────────────────────────────────

export class ExamSectionDto {
  @IsNotEmpty()
  @IsUUID('4')
  subjectId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalQuestions: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  displayOrder?: number;
}

// ─── Create Exam ───────────────────────────────────────────────

export class CreateExamDto {
  @IsNotEmpty()
  @IsUUID('4')
  examTargetId: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalQuestions: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalMarks: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  durationMinutes: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  defaultMarksPerQuestion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  defaultNegativeMarks?: number;

  @IsOptional()
  @IsDateString()
  examDate?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamSectionDto)
  sections: ExamSectionDto[];
}

// ─── Update Exam ───────────────────────────────────────────────

export class UpdateExamDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  durationMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  defaultMarksPerQuestion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  defaultNegativeMarks?: number;

  @IsOptional()
  @IsDateString()
  examDate?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;
}

// ─── Generate Exam (auto-pick questions) ───────────────────────

export class GenerateExamQuestionsDto {
  @IsNotEmpty()
  @IsUUID('4')
  examId: string;
}

// ─── Add specific questions to exam ────────────────────────────

export class AddExamQuestionsDto {
  @IsNotEmpty()
  @IsUUID('4')
  examId: string;

  @IsNotEmpty()
  @IsUUID('4')
  sectionId: string;

  @IsArray()
  @IsUUID('4', { each: true })
  questionIds: string[];
}

// ─── Exam List Filter ──────────────────────────────────────────

export class ExamFilterDto {
  @IsOptional()
  @IsUUID('4')
  examTargetId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class CreateExamFromTemplateDto {
  @IsNotEmpty()
  @IsUUID('4')
  examTargetId: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
