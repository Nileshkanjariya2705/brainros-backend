import {
  IsNotEmpty,
  IsUUID,
  IsISO8601,
  IsString,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';

export enum AdminExamTypeEnum {
  SPECIFIC_SUBJECT = 'SPECIFIC_SUBJECT',
  SPECIFIC_CHAPTER = 'SPECIFIC_CHAPTER',
  JEE = 'JEE',
  NEET = 'NEET',
  CET = 'CET',
  JEE_NEET_CET = 'JEE_NEET_CET',
}

export class AdminScheduleExamDto {
  @IsNotEmpty()
  @IsString()
  examType: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  examTargetId?: string;

  @IsOptional()
  @IsUUID()
  blueprintId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalQuestions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsNotEmpty()
  @IsISO8601()
  startTime: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'Asia/Kolkata';
}
