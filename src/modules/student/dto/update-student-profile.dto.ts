import { IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdateStudentProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  preferredLanguageId?: string;
}
