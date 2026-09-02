import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum StudentExamStatusTab {
  ALL = 'ALL',
  UPCOMING = 'UPCOMING',
  LIVE = 'LIVE',
  COMPLETED = 'COMPLETED',
}

export enum StudentMockAttemptStatusTab {
  ALL = 'ALL',
  NOT_ATTEMPTED = 'NOT_ATTEMPTED',
  ATTEMPTED = 'ATTEMPTED',
}

export class StudentExamsQueryDto {
  @IsOptional()
  @IsEnum(StudentExamStatusTab)
  status?: StudentExamStatusTab = StudentExamStatusTab.ALL;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  examTargetId?: string;

  @IsOptional()
  @IsString()
  sort?: string = 'UPCOMING_SOONEST';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 12;
}

export class StudentMockTestsQueryDto {
  @IsOptional()
  @IsEnum(StudentMockAttemptStatusTab)
  attemptStatus?: StudentMockAttemptStatusTab = StudentMockAttemptStatusTab.ALL;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsString()
  examTargetId?: string;

  @IsOptional()
  @IsString()
  sort?: string = 'NEWEST';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 12;
}
