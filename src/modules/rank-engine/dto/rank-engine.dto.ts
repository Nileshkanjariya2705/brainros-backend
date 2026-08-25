import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateRankDto {
  @IsOptional()
  @IsUUID('4')
  examVersionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  snapshotVersion?: number;

  @IsOptional()
  @IsBoolean()
  forceRegenerate?: boolean;
}

export class QueryLeaderboardDto {
  @IsOptional()
  @IsString()
  rankType?: string; // OVERALL, STATE, DISTRICT, SCHOOL, CATEGORY

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 25;

  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateRankingConfigDto {
  @IsOptional()
  @IsUUID('4')
  examId?: string;

  @IsOptional()
  @IsUUID('4')
  examTargetId?: string;

  @IsOptional()
  @IsString()
  rankMode?: string; // COMPETITION, DENSE, ORDINAL

  @IsOptional()
  tieBreakOrder?: string[];

  @IsOptional()
  @IsString()
  percentileMethod?: string; // STANDARD, FRACTIONAL
}
