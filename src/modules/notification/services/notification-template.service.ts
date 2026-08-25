import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateNotificationTemplateDto } from '../dto/notification.dto';

@Injectable()
export class NotificationTemplateService implements OnModuleInit {
  private readonly logger = new Logger(NotificationTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultTemplates();
  }

  /**
   * Resolves the latest active template for a given type, channel, and language.
   * Falls back to 'en' (English) if the requested language is missing.
   */
  async resolveTemplate(
    type: NotificationType,
    channel: NotificationChannel,
    languageCode = 'en',
  ) {
    let template = await this.prisma.notificationTemplate.findFirst({
      where: {
        notificationType: type,
        channel,
        languageCode: languageCode.toLowerCase(),
        isActive: true,
      },
      orderBy: { version: 'desc' },
    });

    // Fallback to English if not found
    if (!template && languageCode.toLowerCase() !== 'en') {
      template = await this.prisma.notificationTemplate.findFirst({
        where: {
          notificationType: type,
          channel,
          languageCode: 'en',
          isActive: true,
        },
        orderBy: { version: 'desc' },
      });
    }

    return template;
  }

  /**
   * Safely interpolate template variables using regex without eval()
   */
  renderTemplate(
    templateBody: string,
    variables: Record<string, any> = {},
  ): string {
    return templateBody.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      const val = variables[key];
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  /**
   * Create or update template by creating an immutable new version.
   */
  async saveTemplate(dto: CreateNotificationTemplateDto) {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: {
        notificationType: dto.notificationType,
        channel: dto.channel,
        languageCode: dto.languageCode.toLowerCase(),
      },
      orderBy: { version: 'desc' },
    });

    const nextVersion = existing ? existing.version + 1 : 1;

    // Deactivate older version if existing
    if (existing) {
      await this.prisma.notificationTemplate.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
    }

    return this.prisma.notificationTemplate.create({
      data: {
        notificationType: dto.notificationType,
        channel: dto.channel,
        languageCode: dto.languageCode.toLowerCase(),
        subject: dto.subject || null,
        body: dto.body,
        variables: dto.variables ? (dto.variables as any) : undefined,
        version: nextVersion,
        isActive: true,
      },
    });
  }

  /**
   * Seed core system templates if missing
   */
  private async seedDefaultTemplates() {
    try {
      const count = await this.prisma.notificationTemplate.count();
      if (count > 0) return;

      const defaults: CreateNotificationTemplateDto[] = [
        {
          notificationType: NotificationType.OTP,
          channel: NotificationChannel.SMS,
          languageCode: 'en',
          body: 'Your Brainros security verification code is {{otp}}. Valid for {{validMinutes}} minutes. Do not share this code.',
        },
        {
          notificationType: NotificationType.REGISTRATION_CONFIRMATION,
          channel: NotificationChannel.EMAIL,
          languageCode: 'en',
          subject: 'Welcome to Brainros Exam Management Platform',
          body: 'Hello {{name}},\n\nYour account has been successfully created. Welcome aboard!',
        },
        {
          notificationType: NotificationType.EXAM_SCHEDULED,
          channel: NotificationChannel.EMAIL,
          languageCode: 'en',
          subject: 'Exam Scheduled: {{examTitle}}',
          body: 'Hello {{studentName}},\n\n{{examTitle}} is scheduled for {{plannedDate}} at {{startTime}} ({{timezone}}).',
        },
        {
          notificationType: NotificationType.EXAM_REMINDER,
          channel: NotificationChannel.PUSH,
          languageCode: 'en',
          body: 'Reminder: {{examTitle}} starts in {{startsIn}}! Make sure you are ready.',
        },
        {
          notificationType: NotificationType.RESULT_AVAILABLE,
          channel: NotificationChannel.EMAIL,
          languageCode: 'en',
          subject: 'Your Exam Result is Ready: {{examTitle}}',
          body: 'Hello {{studentName}},\n\nYour evaluation and analytics for {{examTitle}} are now live in your student portal.',
        },
        {
          notificationType: NotificationType.REPORT_READY,
          channel: NotificationChannel.EMAIL,
          languageCode: 'en',
          subject: 'Your Downloadable Report is Ready',
          body: 'Hello {{name}},\n\nYour requested report {{fileName}} is ready for download in your institution portal.',
        },
      ];

      for (const t of defaults) {
        await this.saveTemplate(t);
      }
      this.logger.log('Seeded default notification templates');
    } catch (err: any) {
      this.logger.warn(`Failed seeding notification templates: ${err.message}`);
    }
  }
}
