import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

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

// Controllers
import { NotificationController } from './controllers/notification.controller';
import { AdminNotificationController } from './controllers/admin-notification.controller';

@Module({
  imports: [PrismaModule, RedisModule],
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
  ],
  exports: [
    NotificationService,
    NotificationTemplateService,
    NotificationPreferenceService,
    ProviderRegistry,
  ],
})
export class NotificationModule {}
