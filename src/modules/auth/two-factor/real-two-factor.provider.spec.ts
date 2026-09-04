import { ConfigService } from '@nestjs/config';
import { RealTwoFactorProvider } from './real-two-factor.provider';
import { TwoFactorConfig } from '../config/two-factor.config';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

describe('RealTwoFactorProvider (MSG91)', () => {
  let provider: RealTwoFactorProvider;
  let configServiceMock: jest.Mocked<ConfigService>;
  let configMock: Partial<TwoFactorConfig>;

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MSG91_AUTH_KEY') return '567446A9gJtDpx6a9a2e53P1';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    configMock = {
      msg91AuthKey: '567446A9gJtDpx6a9a2e53P1',
      msg91TemplateId: '',
      otpLength: 5,
      otpTtl: 300,
    };

    provider = new RealTwoFactorProvider(configServiceMock, configMock as TwoFactorConfig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('formatMobileForMsg91', () => {
    it('should format 10-digit Indian numbers with 91 prefix', () => {
      expect(provider.formatMobileForMsg91('9876543210')).toBe('919876543210');
    });

    it('should strip leading + from +91 numbers', () => {
      expect(provider.formatMobileForMsg91('+919876543210')).toBe('919876543210');
    });

    it('should leave already formatted numbers intact', () => {
      expect(provider.formatMobileForMsg91('919876543210')).toBe('919876543210');
    });
  });

  describe('sendOtp', () => {
    it('should successfully send OTP via MSG91 API', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'success',
          message: 'OTP sent successfully',
          request_id: 'req-12345',
        }),
      } as any);

      const result = await provider.sendOtp('+919876543210', 'LOGIN');

      expect(result).toEqual({
        sessionId: '919876543210',
        providerManaged: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://control.msg91.com/api/v5/otp?mobile=919876543210'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authkey: '567446A9gJtDpx6a9a2e53P1',
          }),
        }),
      );
    });

    it('should throw BadRequestException when MSG91 returns type=error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          type: 'error',
          message: 'Invalid mobile number',
        }),
      } as any);

      await expect(provider.sendOtp('+919876543210', 'LOGIN')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyOtp', () => {
    it('should return true when MSG91 verification succeeds', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'success',
          message: 'OTP verified success',
        }),
      } as any);

      const isValid = await provider.verifyOtp('+919876543210', '12345', 'LOGIN');
      expect(isValid).toBe(true);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://control.msg91.com/api/v5/otp/verify?mobile=919876543210&otp=12345',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            authkey: '567446A9gJtDpx6a9a2e53P1',
          }),
        }),
      );
    });

    it('should return false when MSG91 returns OTP not matched', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'error',
          message: 'OTP not match',
        }),
      } as any);

      const isValid = await provider.verifyOtp('+919876543210', '99999', 'LOGIN');
      expect(isValid).toBe(false);
    });
  });

  describe('resendOtp', () => {
    it('should call MSG91 retry endpoint and return true on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'success',
          message: 'OTP resent successfully',
        }),
      } as any);

      const res = await provider.resendOtp('+919876543210', 'text');
      expect(res).toBe(true);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://control.msg91.com/api/v5/otp/retry?mobile=919876543210&retrytype=text',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            authkey: '567446A9gJtDpx6a9a2e53P1',
          }),
        }),
      );
    });
  });
});
