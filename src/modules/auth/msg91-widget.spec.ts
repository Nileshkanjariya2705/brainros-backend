import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { OtpService } from './services/otp.service';
import { OtpController } from './otp.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MSG91 OTP Widget Verification & User Existence', () => {
  let otpService: OtpService;
  let otpController: OtpController;
  let httpService: jest.Mocked<Partial<HttpService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let prismaService: jest.Mocked<Partial<PrismaService>>;
  let twoFactorService: jest.Mocked<Partial<TwoFactorService>>;
  let authService: jest.Mocked<Partial<AuthService>>;

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'MSG91_AUTH_KEY') return 'test-auth-key';
        if (key === 'MSG91_VERIFY_URL') return 'https://api.msg91.com/api/v5/widget/verifyAccessToken';
        return undefined;
      }),
    };

    prismaService = {
      user: {
        findFirst: jest.fn(),
      } as any,
    };

    twoFactorService = {
      normalizeMobileNumber: jest.fn((num: string) => num.startsWith('+') ? num : `+91${num.replace(/\D/g, '')}`),
    };

    authService = {
      loginWithVerifiedUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        OtpService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prismaService },
        { provide: TwoFactorService, useValue: twoFactorService },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    otpService = module.get<OtpService>(OtpService);
    otpController = module.get<OtpController>(OtpController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('OtpService.verifyAccessToken', () => {
    it('should throw BadRequestException if access token is empty', async () => {
      await expect(otpService.verifyAccessToken('')).rejects.toThrow(BadRequestException);
    });

    it('should verify access_token with MSG91 and authenticate user', async () => {
      const mockMsg91Response = {
        data: {
          type: 'success',
          mobile: '919876543210',
          message: 'Token verified successfully',
        },
      };

      (httpService.post as jest.Mock).mockReturnValueOnce(of(mockMsg91Response));

      const mockUser = { id: 'user-uuid-123', mobileNumber: '+919876543210' };
      (prismaService.user!.findFirst as jest.Mock).mockResolvedValueOnce(mockUser);

      const mockAuthResponse = {
        message: 'Login successful via MSG91 OTP Widget',
        data: { accessToken: 'jwt-access-token', refreshToken: 'jwt-refresh-token' },
      };
      (authService.loginWithVerifiedUser as jest.Mock).mockResolvedValueOnce(mockAuthResponse);

      const result = await otpService.verifyAccessToken('valid-access-token');

      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.msg91.com/api/v5/widget/verifyAccessToken',
        { 'access-token': 'valid-access-token' },
        expect.objectContaining({
          headers: {
            authkey: 'test-auth-key',
            'Content-Type': 'application/json',
          },
        }),
      );

      expect(authService.loginWithVerifiedUser).toHaveBeenCalledWith(mockUser, undefined);
      expect(result).toEqual(mockAuthResponse);
    });

    it('should throw UnauthorizedException if MSG91 returns error type', async () => {
      const mockMsg91Response = {
        data: {
          type: 'error',
          message: 'Invalid or expired access token',
        },
      };

      (httpService.post as jest.Mock).mockReturnValueOnce(of(mockMsg91Response));

      await expect(otpService.verifyAccessToken('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException if user is not in database', async () => {
      const mockMsg91Response = {
        data: {
          type: 'success',
          mobile: '919999999999',
        },
      };

      (httpService.post as jest.Mock).mockReturnValueOnce(of(mockMsg91Response));
      (prismaService.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(otpService.verifyAccessToken('valid-token-new-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('OtpService.checkUserExists', () => {
    it('should return user_found: true when user exists in DB', async () => {
      (prismaService.user!.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'user-1' });

      const res = await otpService.checkUserExists('+919876543210');

      expect(res).toEqual({
        user_found: true,
        identifier: '+919876543210',
      });
    });

    it('should return user_found: false when user does not exist in DB', async () => {
      (prismaService.user!.findFirst as jest.Mock).mockResolvedValueOnce(null);

      const res = await otpService.checkUserExists('nonexistent@example.com');

      expect(res).toEqual({
        user_found: false,
        identifier: 'nonexistent@example.com',
      });
    });
  });

  describe('OtpController', () => {
    it('POST /auth/otp/verify should call verifyAccessToken and return result', async () => {
      const mockAuthResponse = {
        message: 'Login successful via MSG91 OTP Widget',
        data: { accessToken: 'token-123', refreshToken: 'refresh-123' },
      };

      jest.spyOn(otpService, 'verifyAccessToken').mockResolvedValueOnce(mockAuthResponse);

      const mockRes = { cookie: jest.fn() } as any;

      const res = await otpController.verifyOtpToken({ token: 'widget-token-abc' }, {} as any, mockRes);

      expect(otpService.verifyAccessToken).toHaveBeenCalledWith('widget-token-abc', expect.anything());
      expect(res).toEqual(mockAuthResponse);
    });

    it('GET /auth/otp/check-user should call checkUserExists', async () => {
      const mockResult = { user_found: true, identifier: '9876543210' };
      jest.spyOn(otpService, 'checkUserExists').mockResolvedValueOnce(mockResult);

      const res = await otpController.checkUserExists({ identifier: '9876543210' });

      expect(otpService.checkUserExists).toHaveBeenCalledWith('9876543210');
      expect(res).toEqual(mockResult);
    });
  });
});
