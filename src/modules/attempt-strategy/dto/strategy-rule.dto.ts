import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  StrategyCategory,
  StrategyOperator,
  StrategySeverity,
} from '../interfaces/attempt-strategy.interface';

export class CreateStrategyRuleDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsString()
  category: string;

  @IsNotEmpty()
  @IsString()
  metric: string;

  @IsNotEmpty()
  @IsString()
  operator: string;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  threshold: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  comparisonValue?: number;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  priority?: number;

  @IsNotEmpty()
  @IsString()
  recommendationTemplate: string;

  @IsOptional()
  @IsString()
  titleTemplate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID('4')
  examTargetId?: string;

  @IsOptional()
  @IsUUID('4')
  examId?: string;
}

export class UpdateStrategyRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  metric?: string;

  @IsOptional()
  @IsString()
  operator?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  threshold?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  comparisonValue?: number;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  priority?: number;

  @IsOptional()
  @IsString()
  recommendationTemplate?: string;

  @IsOptional()
  @IsString()
  titleTemplate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryStrategyRulesDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsOptional()
  @IsUUID('4')
  examTargetId?: string;
}

export class RecalculateStrategyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  strategyVersion?: number;
}
