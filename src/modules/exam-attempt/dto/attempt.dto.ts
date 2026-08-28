import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Start Attempt ─────────────────────────────────────────────

export class StartAttemptDto {
  @IsNotEmpty()
  @IsUUID('4')
  examId: string;

  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;
}

// ─── Save Answer (single question) ────────────────────────────

export class SaveAnswerDto {
  @IsNotEmpty()
  @IsUUID('4')
  examQuestionId: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID('4')
  selectedOptionId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Type(() => Number)
  numericalAnswer?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsArray()
  @IsUUID('4', { each: true })
  selectedOptions?: string[] | null;

  @IsOptional()
  @IsBoolean()
  isMarkedForReview?: boolean;
}

// ─── Bulk Save Answers ─────────────────────────────────────────

export class BulkSaveAnswersDto {
  @IsArray()
  answers: SaveAnswerDto[];
}

// ─── Time Log ──────────────────────────────────────────────────

export class SaveTimeLogDto {
  @IsNotEmpty()
  @IsUUID('4')
  examQuestionId: string;

  @IsNotEmpty()
  @IsDateString()
  startTime: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  timeSpentSeconds?: number;
}
