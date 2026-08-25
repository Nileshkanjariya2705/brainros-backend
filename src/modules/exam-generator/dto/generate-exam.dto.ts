import { IsOptional, IsString } from 'class-validator';

export class GenerateExamDto {
  @IsOptional()
  @IsString()
  generationSeed?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ValidateBlueprintDto {
  @IsOptional()
  @IsString()
  checkLanguages?: boolean = true;
}
