import { IsNotEmpty, IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateQuestionExplanationDto {
  @IsNotEmpty()
  @IsString()
  explanation: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;
}
