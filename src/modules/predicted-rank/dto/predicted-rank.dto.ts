import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateHistoricalExamDto {
  @IsNotEmpty()
  @IsString()
  examName: string;

  @IsNotEmpty()
  @IsString()
  examType: string; // NEET, JEE_MAIN, JEE_ADVANCED, etc.

  @IsOptional()
  @IsString()
  examDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  durationMinutes?: number = 180;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  totalMarks: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  totalCandidates: number;

  @IsOptional()
  @IsString()
  source?: string = 'INTERNAL_RESULTS';
}

export class HistoricalScoreRangeItemDto {
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  minScore: number;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  maxScore: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  representativeScore?: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  minRank: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxRank: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  candidateCount: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  percentileMin?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  percentileMax?: number;
}

export class ImportHistoricalDatasetDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoricalScoreRangeItemDto)
  scoreRanges: HistoricalScoreRangeItemDto[];
}

export class GeneratePredictionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  configVersion?: number = 1;

  @IsOptional()
  forceRegenerate?: boolean = false;
}
