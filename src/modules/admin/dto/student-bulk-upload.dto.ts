import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BulkStudentUploadQueryDto {
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
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ConfirmBulkStudentRegistrationDto {
  @IsNotEmpty()
  @IsUUID()
  uploadId: string;
}

export interface BulkStudentRowNormalized {
  name: string;
  mobile: string;
  email?: string | null;
  state?: string | null;
  city?: string | null;
  class?: string | null;
  examTarget?: string | null;
  preferredLanguage?: string | null;
  schoolCollege?: string | null;
}

export interface BulkStudentRowError {
  field: string;
  errorCode: string;
  message: string;
}
