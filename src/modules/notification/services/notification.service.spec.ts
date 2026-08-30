import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '@prisma/client';
import { NotificationService } from './notification.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { PrismaService } from '../../prisma/prisma.service';

describe('NotificationService (Asynchronous Delivery & Failure Isolation)', () => {
  let service: NotificationService;
  let prisma: any;
  let templateService: any;
  let preferenceService: any;
  let providerRegistry: any;
  let mockProvider: any;

  beforeEach(async () => {
    mockProvider = {
      channel: NotificationChannel.EMAIL,
      providerName: 'TestProvider',
      send: jest.fn().mockResolvedValue({
        success: true,
        provider: 'TestProvider',
        providerMessageId: 'test-msg-123',
      }),
    };

    providerRegistry = {
      getProvider: jest.fn().mockReturnValue(mockProvider),
    };

    templateService = {
      resolveTemplate: jest.fn().mockResolvedValue({
        id: 'tmpl-1',
        version: 1,
        body: 'Hello {{name}}!',
        subject: 'Welcome',
      }),
      renderTemplate: jest.fn((body, vars) =>
        vars?.name ? `Hello ${vars.name}!` : body,
      ),
    };

    preferenceService = {
      isNotificationAllowed: jest.fn().mockResolvedValue(true),
    };

    prisma = {
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((args) => ({ id: 'notif-1', ...args.data })),
        update: jest.fn().mockResolvedValue({ id: 'notif-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      notificationLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationTemplateService, useValue: templateService },
        { provide: NotificationPreferenceService, useValue: preferenceService },
        { provide: ProviderRegistry, useValue: providerRegistry },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  describe('sendNotification (Failure Isolation)', () => {
    it('should create a notification and return cleanly even if internal processing encounters issues', async () => {
      const res: any = await service.sendNotification({
        recipientUserId: 'u-1',
        recipientAddress: 'student@example.com',
        channel: NotificationChannel.EMAIL,
        type: NotificationType.EXAM_SCHEDULED,
        variables: { name: 'Aryan' },
      });

      expect(res.id).toBe('notif-1');
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('should skip notification when disallowed by user preference', async () => {
      preferenceService.isNotificationAllowed.mockResolvedValue(false);

      const res = await service.sendNotification({
        recipientUserId: 'u-1',
        recipientAddress: 'student@example.com',
        channel: NotificationChannel.EMAIL,
        type: NotificationType.EXAM_SCHEDULED,
        variables: { name: 'Aryan' },
      });

      expect(res).toEqual({ status: 'SKIPPED_BY_PREFERENCE' });
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('should deduplicate identical notifications with matching idempotencyKey', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'existing-notif',
        idempotencyKey: 'idemp-1',
      });

      const res: any = await service.sendNotification({
        recipientUserId: 'u-1',
        recipientAddress: 'student@example.com',
        channel: NotificationChannel.EMAIL,
        type: NotificationType.EXAM_SCHEDULED,
        variables: { name: 'Aryan' },
        idempotencyKey: 'idemp-1',
      });

      expect(res.id).toBe('existing-notif');
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('processNotification & Delivery Logging', () => {
    it('should invoke the correct provider and record delivery log on success', async () => {
      await service.processNotification('notif-1', {
        notificationId: 'notif-1',
        recipientAddress: 'student@example.com',
        channel: NotificationChannel.EMAIL,
        type: NotificationType.EXAM_SCHEDULED,
        body: 'Hello Aryan!',
      });

      expect(mockProvider.send).toHaveBeenCalled();
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({ status: 'SENT' }),
        }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationId: 'notif-1',
            status: 'SENT',
            provider: 'TestProvider',
          }),
        }),
      );
    });

    it('should record failure log when provider reports failure without crashing', async () => {
      mockProvider.send.mockResolvedValue({
        success: false,
        provider: 'TestProvider',
        errorCode: 'MAILBOX_FULL',
        errorMessage: 'Storage full',
        isRetryable: false,
      });

      await service.processNotification('notif-1', {
        notificationId: 'notif-1',
        recipientAddress: 'student@example.com',
        channel: NotificationChannel.EMAIL,
        type: NotificationType.EXAM_SCHEDULED,
        body: 'Hello Aryan!',
      });

      expect(prisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationId: 'notif-1',
            status: 'FAILED',
            errorCode: 'MAILBOX_FULL',
          }),
        }),
      );
    });
  });

  describe('OTP Security Handling', () => {
    it('should dispatch critical OTP messages with priority CRITICAL', async () => {
      await service.sendOtp('+919876543210', '123456', 10, 'u-1');

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.OTP,
            priority: NotificationPriority.CRITICAL,
            channel: NotificationChannel.SMS,
          }),
        }),
      );
    });
  });
});
