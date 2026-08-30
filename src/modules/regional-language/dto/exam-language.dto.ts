import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SwitchExamLanguageDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;
}

export class ExamLanguageItemDto {
  @IsNotEmpty()
  @IsUUID('4')
  languageId: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean = false;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  displayOrder?: number = 0;
}

export class SetExamLanguagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamLanguageItemDto)
  languages: ExamLanguageItemDto[];
}
