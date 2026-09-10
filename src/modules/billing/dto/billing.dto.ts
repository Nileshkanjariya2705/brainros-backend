import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsUUID,
  IsBoolean,
  Min,
  IsDateString,
  IsInt,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum BillStatusFilter {
  ALL = 'ALL',
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  GENERATED = 'GENERATED',
  SENT = 'SENT',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export class CreateBillDto {
  @IsUUID('4', { message: 'A valid School/Institution must be selected.' })
  @IsNotEmpty({ message: 'School/Institution is required.' })
  institutionId: string;

  @IsOptional()
  @IsDateString({}, { message: 'Invalid bill date format.' })
  billDate?: string;

  @IsString()
  @IsNotEmpty({ message: 'Bill description is required.' })
  description: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Amount must be a numeric value.' })
  @Min(0, { message: 'Amount cannot be negative.' })
  amount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Tax must be a numeric value.' })
  @Min(0, { message: 'Tax cannot be negative.' })
  tax?: number = 0;

  @IsOptional()
  @IsBoolean()
  submitImmediately?: boolean = false;
}

export class UpdateBillDto {
  @IsOptional()
  @IsDateString({}, { message: 'Invalid bill date format.' })
  billDate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax?: number;
}

export class RejectBillDto {
  @IsString()
  @IsNotEmpty({ message: 'Rejection reason is mandatory.' })
  reason: string;
}

export class GenerateInvoiceDto {
  @IsOptional()
  @IsUUID('4', { message: 'Invalid School/Institution ID format.' })
  institutionId?: string;

  @Type(() => Number)
  @IsInt({ message: 'Billing month must be an integer (1 - 12).' })
  @Min(1, { message: 'Billing month cannot be less than 1 (January).' })
  @Max(12, { message: 'Billing month cannot be greater than 12 (December).' })
  billingMonth: number;

  @Type(() => Number)
  @IsInt({ message: 'Billing year must be an integer.' })
  @Min(2020, { message: 'Billing year must be 2020 or later.' })
  @Max(2100, { message: 'Billing year cannot exceed 2100.' })
  billingYear: number;

  @IsOptional()
  @IsBoolean()
  generateAll?: boolean = false;
}

export class UpdatePricingDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'Price per student must be a valid number.' })
  @Min(1, { message: 'Price per student must be at least ₹1.' })
  pricePerStudent: number;
}

export class BillFilterDto {
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
  status?: string;

  @IsOptional()
  @IsUUID('4')
  institutionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  sortOrder?: 'asc' | 'desc' | 'ASC' | 'DESC' = 'desc';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
