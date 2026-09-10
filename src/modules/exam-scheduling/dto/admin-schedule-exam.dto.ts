import {
  IsNotEmpty,
  IsUUID,
  IsISO8601,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  IsIn,
} from 'class-validator';

export enum NewExamTypeEnum {
  SPECIFIC_SUBJECT = 'SPECIFIC_SUBJECT',
  SPECIFIC_CHAPTER = 'SPECIFIC_CHAPTER',
  FULL_EXAM = 'FULL_EXAM',
}

export enum FullExamTargetEnum {
  JEE = 'JEE',
  NEET = 'NEET',
  CET = 'CET',
}

export enum FullExamConfigModeEnum {
  MANUAL = 'MANUAL',
  BLUEPRINT = 'BLUEPRINT',
}

export class CheckQuestionAvailabilityDto {
  @IsOptional()
  @IsString()
  examType?: string;

  @IsOptional()
  @IsUUID()
  examTargetId?: string;

  @IsOptional()
  @IsString()
  examTargetName?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  blueprintId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  questionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  requestedCount?: number;
}

export class AdminScheduleExamDto {
  @IsNotEmpty()
  @IsString()
  examType: string; // SPECIFIC_SUBJECT | SPECIFIC_CHAPTER | FULL_EXAM | JEE | NEET | CET

  @IsOptional()
  @IsString()
  examName?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  examTargetName?: string; // 'JEE' | 'NEET' | 'CET'

  @IsOptional()
  @IsUUID()
  examTargetId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['MANUAL', 'BLUEPRINT'])
  configurationMode?: 'MANUAL' | 'BLUEPRINT' = 'MANUAL';

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  blueprintId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  questionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalQuestions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number; // in minutes

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marksPerQuestion?: number = 4;

  @IsOptional()
  @IsNumber()
  @Min(0)
  negativeMarks?: number = 1;

  @IsOptional()
  @IsUUID()
  languageId?: string;

  @IsOptional()
  languageIds?: string[];

  @IsNotEmpty()
  @IsISO8601()
  startTime: string; // ISO 8601 timestamp

  @IsOptional()
  @IsString()
  timezone?: string = 'Asia/Kolkata';
}
