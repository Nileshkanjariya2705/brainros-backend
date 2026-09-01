import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionDifficultyEnum, QuestionTypeEnum } from '@prisma/client';

export class DifficultyDistributionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  easyCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  easyPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  mediumCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  mediumPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hardCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  hardPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  veryHardCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  veryHardPercentage?: number;
}

export class QuestionTypeCountDto {
  @IsEnum(QuestionTypeEnum)
  type: QuestionTypeEnum;

  @IsNumber()
  @Min(1)
  count: number;
}

export class ExamSectionFilterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  subjectId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chapterIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicIds?: string[];

  @IsNumber()
  @Min(1)
  totalQuestions: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marksPerQuestion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  negativeMarks?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DifficultyDistributionDto)
  difficultyDistribution?: DifficultyDistributionDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionTypeCountDto)
  questionTypes?: QuestionTypeCountDto[];
}

export class ValidateExamGenerationFiltersDto {
  @IsString()
  @IsNotEmpty()
  examTargetId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamSectionFilterDto)
  sections: ExamSectionFilterDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredLanguageIds?: string[];

  @IsOptional()
  @IsString()
  importSessionId?: string;

  @IsOptional()
  @IsBoolean()
  onlyApprovedQuestions?: boolean;
}

export class PreviewExamGenerationFiltersDto extends ValidateExamGenerationFiltersDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(1)
  durationMinutes: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultMarksPerQuestion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultNegativeMarks?: number;

  @IsOptional()
  @IsString()
  generationSeed?: string;
}

export class FinalizeExamGenerationFiltersDto extends PreviewExamGenerationFiltersDto {
  @IsOptional()
  @IsBoolean()
  publishImmediately?: boolean;
}

export class CreateExamFromImportDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  examTargetId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultMarksPerQuestion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultNegativeMarks?: number;

  @IsOptional()
  @IsBoolean()
  publishImmediately?: boolean;
}
