import { IsOptional, IsEnum, IsArray, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionTypeEnum } from '../enums/question-type.enum';

export class CreateQuestionAnswerDto {
  @IsOptional()
  @IsEnum(QuestionTypeEnum)
  answerType?: QuestionTypeEnum;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  correctOptionIds?: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  numericalAnswer?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  numericalTolerance?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  numericalRangeStart?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  numericalRangeEnd?: number;

  @IsOptional()
  matchPairs?: Array<{ leftOptionKey: string; rightOptionKey: string }> | Record<string, string> | any;
}
