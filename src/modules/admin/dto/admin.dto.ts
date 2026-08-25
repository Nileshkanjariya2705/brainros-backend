import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════════
// Approval DTOs
// ═══════════════════════════════════════════════════════════════════

export class SubmitApprovalDto {
  @IsString()
  @IsNotEmpty()
  entityType: string; // QUESTION, QUESTION_TRANSLATION, EXAM, INSTITUTION, BULK_UPLOAD

  @IsUUID()
  entityId: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class ApproveRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Rejection reason is mandatory.' })
  reason: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CancelRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkApproveDto {
  @IsArray()
  @IsUUID('4', { each: true })
  approvalRequestIds: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}

export class ApprovalFilterDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  submittedBy?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

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

// ═══════════════════════════════════════════════════════════════════
// High-Risk Action DTOs
// ═══════════════════════════════════════════════════════════════════

export class ActivateExamDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DeactivateExamDto {
  @IsString()
  @IsNotEmpty({ message: 'Deactivation reason is mandatory.' })
  reason: string;
}

export class BulkActivateExamsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  examIds: string[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Audit & Search DTOs
// ═══════════════════════════════════════════════════════════════════

export class AuditLogFilterDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

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

export class AdminUserSearchDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;

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

export class AdminDashboardFilterDto {
  @IsOptional()
  @IsString()
  range?: string; // 'TODAY' | '7D' | '30D' | '90D'
}
