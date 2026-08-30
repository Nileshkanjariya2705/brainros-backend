import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ImportFormatEnum {
  XLSX = 'xlsx',
  CSV = 'csv',
}

export class QuestionImportFilterDto {
  @IsOptional()
  @IsString()
  status?: string; // 'ALL', 'VALID', 'INVALID', 'DUPLICATE', 'UPDATE_AVAILABLE'

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
  @Max(200)
  @Type(() => Number)
  limit?: number = 20;
}

export class UpdateImportRowDto {
  @IsOptional()
  rawData?: Record<string, any>;

  @IsOptional()
  @IsString()
  action?: 'CREATE' | 'UPDATE' | 'NONE';

  @IsOptional()
  @IsString()
  targetQuestionId?: string;
}
