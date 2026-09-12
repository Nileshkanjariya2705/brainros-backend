import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import {
  NOTIFICATION_QUEUE_NAME,
  WHATSAPP_REMINDER_QUEUE_NAME,
} from './interfaces/exam-notification-job.interface';

// Providers
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { PushProvider } from './providers/push.provider';
import { ProviderRegistry } from './providers/provider.registry';

// Services
import { NotificationTemplateService } from './services/notification-template.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { NotificationService } from './services/notification.service';
import { NotificationQueueService } from './queues/notification-queue.service';

// Processors
import { NotificationProcessor } from './processors/notification.processor';
import { WhatsAppReminderProcessor } from './processors/whatsapp-reminder.processor';

// Controllers
import { NotificationController } from './controllers/notification.controller';
import { AdminNotificationController } from './controllers/admin-notification.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    ConfigModule,
    BullModule.registerQueue(
      // Existing in-app notification queue
      { name: NOTIFICATION_QUEUE_NAME },
      // New WhatsApp Messaging queue (separate from in-app / OTP)
      { name: WHATSAPP_REMINDER_QUEUE_NAME },
    ),
  ],
  controllers: [NotificationController, AdminNotificationController],
  providers: [
    // Channel providers
    EmailProvider,
    SmsProvider,
    WhatsAppProvider,
    PushProvider,
    ProviderRegistry,
    // Services
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationService,
    NotificationQueueService,
    // Processors
    NotificationProcessor,
    WhatsAppReminderProcessor,
  ],
  exports: [
    NotificationService,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationQueueService,
    ProviderRegistry,
    WhatsAppProvider,
    BullModule,
  ],
})
export class NotificationModule {}
