import { IsOptional, IsString } from 'class-validator';

export class SubmitQuestionDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectQuestionDto {
  @IsString()
  reason: string;
}

export class ArchiveQuestionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
