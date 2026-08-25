import { IsOptional, IsString } from 'class-validator';

export class ActionReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CancelExamDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
