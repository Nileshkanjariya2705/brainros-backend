import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum TranslationImportRowStatusFilter {
  ALL = 'ALL',
  PENDING = 'PENDING',
  VALID = 'VALID',
  INVALID = 'INVALID',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  UPDATE_AVAILABLE = 'UPDATE_AVAILABLE',
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum TranslationImportFormatEnum {
  XLSX = 'xlsx',
  CSV = 'csv',
}

export class TranslationImportFilterDto {
  @IsOptional()
  @IsEnum(TranslationImportRowStatusFilter)
  status?: TranslationImportRowStatusFilter = TranslationImportRowStatusFilter.ALL;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  languageCode?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateTranslationImportRowDto {
  @IsOptional()
  @IsObject()
  rawData?: Record<string, any>;

  @IsOptional()
  @IsEnum(['CREATE', 'UPDATE', 'NONE'])
  action?: 'CREATE' | 'UPDATE' | 'NONE';

  @IsOptional()
  @IsString()
  targetQuestionId?: string;

  @IsOptional()
  @IsString()
  targetLanguageId?: string;
}
