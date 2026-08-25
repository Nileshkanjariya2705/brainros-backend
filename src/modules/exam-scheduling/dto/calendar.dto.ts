import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExamCycleStatus, CalendarEventStatus, FeatureCode } from '@prisma/client';

export class CreateExamCycleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  academicYear: string; // e.g. "2026-2027"

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class UpdateExamCycleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ExamCycleStatus)
  status?: ExamCycleStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateExamCalendarEventDto {
  @IsUUID()
  cycleId: string;

  @IsUUID()
  examId: string;

  @IsDateString()
  plannedDate: string; // ISO date

  @IsDateString()
  plannedStartTime: string; // ISO datetime

  @IsDateString()
  plannedEndTime: string; // ISO datetime

  @IsOptional()
  @IsString()
  timezone?: string; // default "Asia/Kolkata"

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RescheduleCalendarEventDto {
  @IsDateString()
  plannedDate: string;

  @IsDateString()
  plannedStartTime: string;

  @IsDateString()
  plannedEndTime: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsString()
  @IsNotEmpty({ message: 'Rescheduling reason is mandatory.' })
  reason: string;
}

export class CalendarFilterDto {
  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  examId?: string;

  @IsOptional()
  @IsEnum(CalendarEventStatus)
  status?: CalendarEventStatus;

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

export class SetFeatureActivationDto {
  @IsEnum(FeatureCode)
  featureCode: FeatureCode;

  @IsOptional()
  @IsString()
  targetType?: string; // "GLOBAL", "EXAM", "INSTITUTION"

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsBoolean()
  isActive: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
