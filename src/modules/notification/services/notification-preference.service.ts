import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateNotificationPreferenceDto } from '../dto/notification.dto';

const CRITICAL_NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.OTP,
  NotificationType.SECURITY_ALERT,
];

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates whether a notification is permitted according to user preferences and security hierarchy.
   */
  async isNotificationAllowed(
    userId: string | null | undefined,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    // 1. Critical security messages cannot be disabled by user preferences
    if (CRITICAL_NOTIFICATION_TYPES.includes(type)) {
      return true;
    }

    // 2. Unlinked anonymous or system recipient defaults to allowed
    if (!userId) {
      return true;
    }

    // 3. Query user preference
    const preference = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_notificationType_channel: {
          userId,
          notificationType: type,
          channel,
        },
      },
    });

    if (preference) {
      return preference.enabled;
    }

    // 4. Default: Enabled
    return true;
  }

  /**
   * Update or create a user notification preference.
   */
  async updatePreference(userId: string, dto: UpdateNotificationPreferenceDto) {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_notificationType_channel: {
          userId,
          notificationType: dto.notificationType,
          channel: dto.channel,
        },
      },
      update: { enabled: dto.enabled },
      create: {
        userId,
        notificationType: dto.notificationType,
        channel: dto.channel,
        enabled: dto.enabled,
      },
    });
  }

  /**
   * Get all preferences for a user.
   */
  async getUserPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
    });
  }
}
