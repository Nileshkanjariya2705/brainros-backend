import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum SecurityLevelEnum {
  STANDARD = 'STANDARD',
  STRICT = 'STRICT',
  HIGH_STAKES = 'HIGH_STAKES',
  LOCKDOWN = 'LOCKDOWN',
}

export enum SecurityActionEnum {
  ALLOW = 'ALLOW',
  WARN = 'WARN',
  FLAG = 'FLAG',
  REQUIRE_REAUTH = 'REQUIRE_REAUTH',
  LOCK = 'LOCK',
  AUTO_SUBMIT = 'AUTO_SUBMIT',
  TERMINATE = 'TERMINATE',
}

export enum SecurityReviewStatusEnum {
  PENDING = 'PENDING',
  CLEARED = 'CLEARED',
  CONFIRMED = 'CONFIRMED',
  DISQUALIFIED = 'DISQUALIFIED',
}

export class SecurityEventItemDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  eventType: string;

  @IsNumber()
  @IsOptional()
  sequenceNumber?: number;

  @IsString()
  @IsOptional()
  clientTimestamp?: string;

  @IsNumber()
  @IsOptional()
  duration?: number;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class IngestSecurityEventsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecurityEventItemDto)
  events: SecurityEventItemDto[];

  @IsString()
  @IsOptional()
  sessionId?: string;
}

export class HeartbeatDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  clientTimestamp?: string;

  @IsOptional()
  deviceMetadata?: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  isFullscreen?: boolean;

  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;
}

export class AcceptSecurityPolicyDto {
  @IsString()
  @IsNotEmpty()
  securityProfileId: string;

  @IsNumber()
  @IsOptional()
  policyVersion?: number;
}

export class ReviewSecurityAttemptDto {
  @IsEnum(SecurityReviewStatusEnum)
  status: SecurityReviewStatusEnum;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class TerminateAttemptDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CreateSecurityProfileDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(SecurityLevelEnum)
  @IsOptional()
  level?: SecurityLevelEnum;

  @IsBoolean()
  @IsOptional()
  fullscreenRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  preventCopyPaste?: boolean;

  @IsBoolean()
  @IsOptional()
  preventContextMenu?: boolean;

  @IsBoolean()
  @IsOptional()
  preventTextSelection?: boolean;

  @IsBoolean()
  @IsOptional()
  detectTabSwitch?: boolean;

  @IsBoolean()
  @IsOptional()
  detectWindowBlur?: boolean;

  @IsBoolean()
  @IsOptional()
  detectFullscreenExit?: boolean;

  @IsBoolean()
  @IsOptional()
  detectMultipleSessions?: boolean;

  @IsBoolean()
  @IsOptional()
  allowNetworkOffline?: boolean;

  @IsBoolean()
  @IsOptional()
  singleSessionRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  singleDeviceRequired?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxTabSwitches?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxFullscreenExits?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  warningThreshold?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  autoTerminateThreshold?: number;

  @IsNumber()
  @IsOptional()
  @Min(10)
  @Max(120)
  heartbeatIntervalSeconds?: number;
}
