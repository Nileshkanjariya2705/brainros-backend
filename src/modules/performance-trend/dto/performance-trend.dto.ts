import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetTrendsQueryDto {
  @IsOptional()
  @IsString()
  examType?: string; // NEET, JEE_MAIN, etc.

  @IsOptional()
  @IsString()
  examId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;
}

export class CompareMocksQueryDto {
  @IsNotEmpty()
  @IsString()
  attemptA: string;

  @IsNotEmpty()
  @IsString()
  attemptB: string;
}
