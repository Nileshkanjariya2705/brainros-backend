import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class StudentComparisonQueryDto {
  @IsOptional()
  @IsString()
  examType?: string;

  @IsOptional()
  @IsString()
  examSeriesId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  attemptIds?: string;
}
