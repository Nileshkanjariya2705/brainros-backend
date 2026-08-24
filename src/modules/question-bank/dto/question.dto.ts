import {
  IsNotEmpty, IsString, IsUUID, IsOptional, IsNumber,
  IsBoolean, IsArray, ValidateNested, IsJSON, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Option Translation ────────────────────────────────────────

export class OptionTranslationDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;

  @IsNotEmpty()
  @IsString()
  optionText: string;
}

// ─── Question Option ───────────────────────────────────────────

export class QuestionOptionDto {
  @IsNotEmpty()
  @IsString()
  optionLabel: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  displayOrder?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionTranslationDto)
  translations: OptionTranslationDto[];
}

// ─── Question Translation ──────────────────────────────────────

export class QuestionTranslationDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;

  @IsNotEmpty()
  @IsString()
  questionText: string;

  @IsOptional()
  @IsString()
  explanation?: string;
}

// ─── Create Question ───────────────────────────────────────────

export class CreateQuestionDto {
  @IsNotEmpty()
  @IsUUID('4')
  subjectId: string;

  @IsNotEmpty()
  @IsUUID('4')
  chapterId: string;

  @IsOptional()
  @IsUUID('4')
  topicId?: string;

  @IsOptional()
  @IsUUID('4')
  subTopicId?: string;

  @IsNotEmpty()
  @IsUUID('4')
  difficultyId: string;

  @IsNotEmpty()
  @IsUUID('4')
  questionTypeId: string;

  @IsNotEmpty()
  @IsUUID('4')
  defaultLanguageId: string;

  @IsOptional()
  correctAnswer?: any;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  marks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  negativeMarks?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionTranslationDto)
  translations: QuestionTranslationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options: QuestionOptionDto[];
}

// ─── Update Question ───────────────────────────────────────────

export class UpdateQuestionDto {
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @IsOptional()
  @IsUUID('4')
  chapterId?: string;

  @IsOptional()
  @IsUUID('4')
  topicId?: string;

  @IsOptional()
  @IsUUID('4')
  subTopicId?: string;

  @IsOptional()
  @IsUUID('4')
  difficultyId?: string;

  @IsOptional()
  @IsUUID('4')
  questionTypeId?: string;

  @IsOptional()
  correctAnswer?: any;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  marks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  negativeMarks?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionTranslationDto)
  translations?: QuestionTranslationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

// ─── Filter Query ──────────────────────────────────────────────

export class QuestionFilterDto {
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @IsOptional()
  @IsUUID('4')
  chapterId?: string;

  @IsOptional()
  @IsUUID('4')
  topicId?: string;

  @IsOptional()
  @IsUUID('4')
  difficultyId?: string;

  @IsOptional()
  @IsUUID('4')
  questionTypeId?: string;

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
