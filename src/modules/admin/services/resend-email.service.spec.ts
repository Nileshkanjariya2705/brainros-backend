import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResendEmailService } from './resend-email.service';

describe('ResendEmailService', () => {
  let service: ResendEmailService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResendEmailService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'EMAIL_API_KEY') return 'test_api_key_123';
              if (key === 'EMAIL_FROM') return 'Brainros <test@brainros.com>';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ResendEmailService>(ResendEmailService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject invalid destination email address gracefully', async () => {
    const result = await service.sendEmail({
      to: 'invalid-email-string',
      subject: 'Test Subject',
      html: '<p>Test</p>',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid destination email');
    expect(result.isRetryable).toBe(false);
  });

  it('should handle mock fetch response correctly', async () => {
    // Mock global.fetch
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_msg_test_123' }),
    } as any);

    const result = await service.sendEmail({
      to: 'student@example.com',
      subject: 'Your Exam Report',
      html: '<p>Attached is your report</p>',
      attachments: [
        {
          filename: 'report.pdf',
          content: Buffer.from('mock-pdf-content'),
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toEqual('resend_msg_test_123');

    global.fetch = originalFetch;
  });
});
