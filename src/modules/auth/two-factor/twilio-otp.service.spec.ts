import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwilioOtpService } from './twilio-otp.service';
import { TwilioVerifyProvider } from './twilio-verify.provider';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

describe('TwilioOtpService & TwilioVerifyProvider', () => {
  let service: TwilioOtpService;
  let provider: TwilioVerifyProvider;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'TWILIO_ACCOUNT_SID':
          return 'ACmockaccount1234567890abcdef1234';
        case 'TWILIO_AUTH_TOKEN':
          return 'mockauthtoken1234567890abcdef123';
        case 'TWILIO_VERIFY_SERVICE_SID':
          return 'VAmservice1234567890abcdef123456';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioOtpService,
        TwilioVerifyProvider,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TwilioOtpService>(TwilioOtpService);
    provider = module.get<TwilioVerifyProvider>(TwilioVerifyProvider);
  });

  describe('Phone number normalization', () => {
    it('normalizes 10-digit Indian numbers to E.164 (+91)', () => {
      expect(service.normalizeMobile('9876543210')).toBe('+919876543210');
      expect(service.normalizeMobile('919876543210')).toBe('+919876543210');
      expect(service.normalizeMobile('+919876543210')).toBe('+919876543210');
    });

    it('masks phone numbers safely without exposing digits', () => {
      expect(service.maskPhone('+919876543210')).toBe('******3210');
    });
  });

  describe('Twilio Verify Provider send and verify', () => {
    it('sends verification via Twilio client and returns sessionId', async () => {
      const mockVerificationsCreate = jest.fn().mockResolvedValue({
        sid: 'VE123456789',
        status: 'pending',
      });

      // Mock twilio client on service
      (service as any).twilioClient = {
        verify: {
          v2: {
            services: () => ({
              verifications: { create: mockVerificationsCreate },
            }),
          },
        },
      };
      (service as any).isConfigured = true;

      const result = await provider.sendOtp('+919876543210', 'LOGIN');
      expect(result.sessionId).toBe('VE123456789');
      expect(result.providerManaged).toBe(true);
      expect(mockVerificationsCreate).toHaveBeenCalledWith({
        to: '+919876543210',
        channel: 'sms',
      });
    });

    it('verifies code and returns true when status is approved', async () => {
      const mockCheckCreate = jest.fn().mockResolvedValue({
        status: 'approved',
      });

      (service as any).twilioClient = {
        verify: {
          v2: {
            services: () => ({
              verificationChecks: { create: mockCheckCreate },
            }),
          },
        },
      };
      (service as any).isConfigured = true;

      const isValid = await provider.verifyOtp('+919876543210', '482910', 'LOGIN');
      expect(isValid).toBe(true);
      expect(mockCheckCreate).toHaveBeenCalledWith({
        to: '+919876543210',
        code: '482910',
      });
    });

    it('returns false when status is pending or not approved', async () => {
      const mockCheckCreate = jest.fn().mockResolvedValue({
        status: 'pending',
      });

      (service as any).twilioClient = {
        verify: {
          v2: {
            services: () => ({
              verificationChecks: { create: mockCheckCreate },
            }),
          },
        },
      };
      (service as any).isConfigured = true;

      const isValid = await provider.verifyOtp('+919876543210', '000000', 'LOGIN');
      expect(isValid).toBe(false);
    });

    it('throws BadRequestException for invalid phone format from Twilio (code 60200)', async () => {
      const twilioError: any = new Error('Invalid parameter');
      twilioError.code = 60200;

      (service as any).twilioClient = {
        verify: {
          v2: {
            services: () => ({
              verifications: {
                create: jest.fn().mockRejectedValue(twilioError),
              },
            }),
          },
        },
      };
      (service as any).isConfigured = true;

      await expect(provider.sendOtp('invalid-phone', 'LOGIN')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
