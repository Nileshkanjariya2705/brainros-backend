import { ConfigService } from '@nestjs/config';
import { TwoFactorDotInProvider } from './two-factor-dot-in.provider';
import { TwoFactorConfig } from '../config/two-factor.config';
import { BadRequestException } from '@nestjs/common';

describe('TwoFactorDotInProvider (2Factor.in)', () => {
  let provider: TwoFactorDotInProvider;
  let configServiceMock: jest.Mocked<ConfigService>;
  let configMock: Partial<TwoFactorConfig>;

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TWO_FACTOR_API_KEY')
          return '749e2f32-9fd7-11f1-9cb1-0200cd936042';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    configMock = {
      twoFactorApiKey: '749e2f32-9fd7-11f1-9cb1-0200cd936042',
      otpLength: 5,
      otpTtl: 300,
    };

    provider = new TwoFactorDotInProvider(
      configServiceMock,
      configMock as TwoFactorConfig,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('formatMobileFor2Factor', () => {
    it('should strip non-digits but keep all numbers (including country code)', () => {
      expect(provider.formatMobileFor2Factor('9876543210')).toBe('9876543210');
    });

    it('should keep country code from +91 numbers', () => {
      expect(provider.formatMobileFor2Factor('+919876543210')).toBe(
        '919876543210',
      );
    });

    it('should keep country code from 91 prefixed numbers', () => {
      expect(provider.formatMobileFor2Factor('919876543210')).toBe(
        '919876543210',
      );
    });
  });

  describe('sendOtp', () => {
    it('should successfully send OTP via 2Factor.in API', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Status: 'Success',
          Details: 'session-uuid-12345',
        }),
      } as any);

      const result = await provider.sendOtp('+919876543210', 'LOGIN');

      expect(result).toEqual({
        sessionId: 'session-uuid-12345',
        providerManaged: true,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://2factor.in/API/V1/749e2f32-9fd7-11f1-9cb1-0200cd936042/SMS/919876543210/AUTOGEN',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should throw BadRequestException when 2Factor returns Error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          Status: 'Error',
          Details: 'Invalid Phone Number',
        }),
      } as any);

      await expect(
        provider.sendOtp('invalid-mobile', 'LOGIN'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    it('should return true when 2Factor verification succeeds with session ID', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Status: 'Success',
          Details: 'OTP Matched',
        }),
      } as any);

      const result = await provider.verifyOtp(
        '+919876543210',
        '12345',
        'LOGIN',
        { sessionId: 'session-uuid-12345' },
      );

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://2factor.in/API/V1/749e2f32-9fd7-11f1-9cb1-0200cd936042/SMS/VERIFY/session-uuid-12345/12345',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return false when 2Factor returns OTP Mismatch', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Status: 'Error',
          Details: 'OTP Mismatch',
        }),
      } as any);

      const result = await provider.verifyOtp(
        '+919876543210',
        '99999',
        'LOGIN',
        { sessionId: 'session-uuid-12345' },
      );

      expect(result).toBe(false);
    });
  });
});
