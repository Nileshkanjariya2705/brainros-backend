import {
  IsNotEmpty, IsString, IsUUID, IsOptional, IsNumber,
  IsEnum, IsArray, ValidateNested, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionDifficultyEnum } from '../enums/question-difficulty.enum';
import { QuestionTypeEnum } from '../enums/question-type.enum';
import { CreateQuestionOptionDto } from './create-option.dto';
import { CreateQuestionAnswerDto } from './create-answer.dto';
import { CreateQuestionExplanationDto } from './create-explanation.dto';
import { CreateQuestionTranslationDto } from './create-translation.dto';

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

  @IsNotEmpty()
  @IsUUID('4')
  defaultLanguageId: string;

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
  @IsString()
  passage?: string;

  @IsOptional()
  @IsString()
  assertion?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  correctAnswer?: any;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionTranslationDto)
  translations: CreateQuestionTranslationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionOptionDto)
  options?: CreateQuestionOptionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateQuestionAnswerDto)
  answer?: CreateQuestionAnswerDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateQuestionExplanationDto)
  explanation?: CreateQuestionExplanationDto;
}
