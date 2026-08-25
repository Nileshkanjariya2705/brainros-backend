import { IsNotEmpty, IsString, IsUUID, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOptionTranslationDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;

  @IsNotEmpty()
  @IsString()
  optionText: string;
}

export class CreateQuestionOptionDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsOptional()
  @IsString()
  optionKey?: string;

  @IsOptional()
  @IsString()
  optionLabel?: string;

  @IsOptional()
  @IsString()
  optionText?: string;

  @IsOptional()
  @IsString()
  matchColumn?: string;

  @IsOptional()
  @IsString()
  matchPairKey?: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  displayOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOptionTranslationDto)
  translations?: CreateOptionTranslationDto[];
}
