import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StartQuestionTimingDto {
  @IsOptional()
  @IsUUID('4')
  examQuestionId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsDateString()
  clientTimestamp?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  clientSequence?: number;

  @IsOptional()
  metadata?: any;
}

export class EndQuestionTimingDto {
  @IsOptional()
  @IsUUID('4')
  examQuestionId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsDateString()
  clientTimestamp?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  clientSequence?: number;

  @IsOptional()
  metadata?: any;
}

export class TimeSyncDto {
  @IsOptional()
  @IsUUID('4')
  activeQuestionId?: string;

  @IsOptional()
  @IsDateString()
  clientTimestamp?: string;
}

export class RecalculateTimeAnalysisDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  analysisVersion?: number;
}
