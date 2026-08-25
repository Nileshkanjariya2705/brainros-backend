import { IsNotEmpty, IsString, IsUUID, IsOptional } from 'class-validator';

export class CreateQuestionTranslationDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;

  @IsNotEmpty()
  @IsString()
  questionText: string;

  @IsOptional()
  @IsString()
  passageText?: string;

  @IsOptional()
  @IsString()
  assertionText?: string;

  @IsOptional()
  @IsString()
  reasonText?: string;

  @IsOptional()
  @IsString()
  explanation?: string;
}
