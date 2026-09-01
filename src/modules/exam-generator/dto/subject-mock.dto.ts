import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SUPPORTED_SUBJECT_NAMES = [
  'PHYSICS',
  'CHEMISTRY',
  'MATHEMATICS',
  'BIOLOGY',
] as const;

export type SupportedSubjectName = typeof SUPPORTED_SUBJECT_NAMES[number];

export class SubjectTemplateQueryDto {
  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv' = 'xlsx';
}

export class DifficultyDistributionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  easyPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  mediumPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  hardPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  veryHardPercentage?: number;
}

export class GenerateSubjectMockDto {
  @IsNotEmpty()
  @IsString()
  importId: string;

  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(360)
  durationMinutes?: number = 60;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  totalQuestions?: number;

  @IsOptional()
  @IsNumber()
  defaultMarksPerQuestion?: number = 4;

  @IsOptional()
  @IsNumber()
  defaultNegativeMarks?: number = 1;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DifficultyDistributionDto)
  difficultyDistribution?: DifficultyDistributionDto;

  @IsOptional()
  @IsBoolean()
  publishImmediately?: boolean = false;
}
