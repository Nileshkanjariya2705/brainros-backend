import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { NOTIFICATION_QUEUE_NAME } from './interfaces/exam-notification-job.interface';

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
import { NotificationProcessor } from './processors/notification.processor';

// Controllers
import { NotificationController } from './controllers/notification.controller';
import { AdminNotificationController } from './controllers/admin-notification.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE_NAME,
    }),
  ],
  controllers: [NotificationController, AdminNotificationController],
  providers: [
    EmailProvider,
    SmsProvider,
    WhatsAppProvider,
    PushProvider,
    ProviderRegistry,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationService,
    NotificationQueueService,
    NotificationProcessor,
  ],
  exports: [
    NotificationService,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationQueueService,
    ProviderRegistry,
  ],
})
export class NotificationModule {}

