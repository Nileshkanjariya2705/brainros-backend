import {
  IsNotEmpty,
  IsUUID,
  IsISO8601,
  IsString,
  IsOptional,
} from 'class-validator';

export class ScheduleExamDto {
  @IsOptional()
  @IsString()
  examVersionId?: string;

  @IsNotEmpty()
  @IsISO8601()
  startTime: string;

  @IsNotEmpty()
  @IsISO8601()
  endTime: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'Asia/Kolkata';
}

export class RescheduleExamDto {
  @IsNotEmpty()
  @IsISO8601()
  startTime: string;

  @IsNotEmpty()
  @IsISO8601()
  endTime: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
