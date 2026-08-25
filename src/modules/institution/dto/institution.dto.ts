import { IsString, IsOptional, IsEnum, IsEmail, IsUUID, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════════
// Institution DTOs
// ═══════════════════════════════════════════════════════════════════

export class CreateInstitutionDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

export class UpdateInstitutionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;
}

export class UpdateInstitutionStatusDto {
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AssignAdminDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsString()
  role?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Batch DTOs
// ═══════════════════════════════════════════════════════════════════

export class CreateBatchDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsUUID()
  examTargetId?: string;

  @IsOptional()
  @IsString()
  classLevel?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class AddStudentToBatchDto {
  @IsUUID()
  studentId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Bulk Upload DTOs
// ═══════════════════════════════════════════════════════════════════

export class SubmitBulkUploadDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewBulkUploadDto {
  @IsString()
  action: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Report DTOs
// ═══════════════════════════════════════════════════════════════════

export class CreateReportJobDto {
  @IsString()
  reportType: string;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  filters?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════
// Query DTOs
// ═══════════════════════════════════════════════════════════════════

export class InstitutionQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DashboardQueryDto {
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
