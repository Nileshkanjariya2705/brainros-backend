import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class UpdateQuestionTranslationDto {
  @IsOptional()
  @IsString()
  questionText?: string;

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

export class CreateOptionTranslationDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;

  @IsNotEmpty()
  @IsString()
  optionText: string;
}

export class UpdateOptionTranslationDto {
  @IsOptional()
  @IsString()
  optionText?: string;
}

export class OptionTranslationItemDto {
  @IsNotEmpty()
  @IsUUID('4')
  optionId: string;

  @IsNotEmpty()
  @IsString()
  optionText: string;
}

export class UpsertFullQuestionTranslationDto {
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionTranslationItemDto)
  optionTranslations?: OptionTranslationItemDto[];
}
