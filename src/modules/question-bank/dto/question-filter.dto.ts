import {
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionStatus } from '../enums/question-status.enum';
import { QuestionDifficultyEnum } from '../enums/question-difficulty.enum';
import { QuestionTypeEnum } from '../enums/question-type.enum';

export class QuestionFilterDto {
  @IsOptional()
  @IsString()
  examTargetId?: string;

  @IsOptional()
  @IsString()
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
  @IsEnum(QuestionDifficultyEnum)
  difficultyLevel?: QuestionDifficultyEnum;

  @IsOptional()
  @IsUUID('4')
  questionTypeId?: string;

  @IsOptional()
  @IsEnum(QuestionTypeEnum)
  type?: QuestionTypeEnum;

  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  version?: number;

  @IsOptional()
  @IsUUID('4')
  createdById?: string;

  @IsOptional()
  @IsUUID('4')
  languageId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
