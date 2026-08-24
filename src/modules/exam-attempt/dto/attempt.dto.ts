import {
  IsNotEmpty, IsUUID, IsOptional, IsBoolean,
  IsNumber, IsArray, IsDateString,
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
  @IsUUID('4')
  selectedOptionId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  numericalAnswer?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selectedOptions?: string[];

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
