import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { INotificationProvider } from './notification-provider.interface';
import { EmailProvider } from './email.provider';
import { SmsProvider } from './sms.provider';
import { WhatsAppProvider } from './whatsapp.provider';
import { PushProvider } from './push.provider';

@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private providers = new Map<NotificationChannel, INotificationProvider>();

  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly smsProvider: SmsProvider,
    private readonly whatsAppProvider: WhatsAppProvider,
    private readonly pushProvider: PushProvider,
  ) {}

  onModuleInit() {
    this.registerProvider(this.emailProvider);
    this.registerProvider(this.smsProvider);
    this.registerProvider(this.whatsAppProvider);
    this.registerProvider(this.pushProvider);
  }

  registerProvider(provider: INotificationProvider) {
    this.providers.set(provider.channel, provider);
  }

  getProvider(channel: NotificationChannel): INotificationProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new NotFoundException(
        `No notification provider registered for channel '${channel}'`,
      );
    }
    return provider;
  }
}
