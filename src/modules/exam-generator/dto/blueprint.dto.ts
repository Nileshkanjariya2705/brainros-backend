import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionDifficultyEnum, QuestionTypeEnum } from '@prisma/client';

export class CreateBlueprintRuleDto {
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
  @IsEnum(QuestionDifficultyEnum)
  difficultyLevel?: QuestionDifficultyEnum;

  @IsOptional()
  @IsEnum(QuestionTypeEnum)
  type?: QuestionTypeEnum;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  selectionCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  selectionPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  priority?: number = 0;
}

export class UpdateBlueprintRuleDto {
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
  @IsEnum(QuestionDifficultyEnum)
  difficultyLevel?: QuestionDifficultyEnum;

  @IsOptional()
  @IsEnum(QuestionTypeEnum)
  type?: QuestionTypeEnum;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  selectionCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  selectionPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  priority?: number;
}

export class CreateBlueprintDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalQuestions: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBlueprintRuleDto)
  rules?: CreateBlueprintRuleDto[];
}

export class UpdateBlueprintDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalQuestions?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBlueprintRuleDto)
  rules?: CreateBlueprintRuleDto[];
}
