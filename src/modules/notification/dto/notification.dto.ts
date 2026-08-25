import {
  IsEnum,
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsObject,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  NotificationChannel,
  NotificationType,
  NotificationPriority,
  NotificationStatus,
} from '@prisma/client';

export class UpdateNotificationPreferenceDto {
  @IsEnum(NotificationType)
  notificationType: NotificationType;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsBoolean()
  enabled: boolean;
}

export class CreateNotificationTemplateDto {
  @IsEnum(NotificationType)
  notificationType: NotificationType;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsString()
  @IsNotEmpty()
  languageCode: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;
}

export class NotificationFilterDto {
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsUUID()
  recipientUserId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
