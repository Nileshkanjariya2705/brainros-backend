import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Auth OTP Flows (MSG91 Registration & Login)', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    authService = {
      registerSendOtp: jest.fn(),
      registerVerifyOtp: jest.fn(),
      loginSendOtp: jest.fn(),
      loginVerifyOtp: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Registration Flow', () => {
    it('Step A: POST /auth/register/send-otp should reject if mobile is already registered', async () => {
      authService.registerSendOtp!.mockRejectedValueOnce(
        new BadRequestException('A user with this mobile number already exists.'),
      );

      await expect(
        controller.registerSendOtp({ mobileNumber: '+919876543210' }, {} as any),
      ).rejects.toThrow(BadRequestException);

      expect(authService.registerSendOtp).toHaveBeenCalledWith(
        { mobileNumber: '+919876543210' },
        expect.anything(),
      );
    });

    it('Step A: POST /auth/register/send-otp should trigger sendOtp when mobile is new', async () => {
      const mockResult = {
        message: 'OTP sent successfully to your mobile number.',
        data: {
          requiresOtp: true,
          purpose: 'REGISTER',
          mobile: '+919876543210',
          mobileMasked: '******3210',
          expiresIn: 300,
          resendAvailableIn: 60,
        },
      };

      authService.registerSendOtp!.mockResolvedValueOnce(mockResult as any);

      const result = await controller.registerSendOtp(
        { mobileNumber: '+919876543210' },
        {} as any,
      );

      expect(result).toEqual(mockResult);
      expect(authService.registerSendOtp).toHaveBeenCalledTimes(1);
    });

    it('Step B: POST /auth/register/verify-otp should verify OTP, save user, and return tokens', async () => {
      const mockResult = {
        message: 'Registration completed successfully.',
        data: {
          user: {
            userId: 'user-uuid-1',
            mobileNumber: '+919876543210',
            roles: ['STUDENT'],
          },
          student: {
            studentId: 'STU001001',
            studentCode: 'BRN-2026-000001',
            name: 'Rahul Patel',
          },
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 900,
        },
      };

      authService.registerVerifyOtp!.mockResolvedValueOnce(mockResult as any);

      const mockRes = {
        cookie: jest.fn(),
      } as any;

      const result = await controller.registerVerifyOtp(
        { mobileNumber: '+919876543210', otp: '12345', name: 'Rahul Patel' },
        {} as any,
        mockRes,
      );

      expect(result).toEqual(mockResult);
      expect(authService.registerVerifyOtp).toHaveBeenCalledWith(
        { mobileNumber: '+919876543210', otp: '12345', name: 'Rahul Patel' },
        expect.anything(),
      );
    });
  });

  describe('2. Login Flow', () => {
    it('Step A: POST /auth/login/send-otp should reject with "User not found" if user does not exist', async () => {
      authService.loginSendOtp!.mockRejectedValueOnce(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.loginSendOtp({ mobileNumber: '+919999999999' }, {} as any),
      ).rejects.toThrow(NotFoundException);

      expect(authService.loginSendOtp).toHaveBeenCalledWith(
        { mobileNumber: '+919999999999' },
        expect.anything(),
      );
    });

    it('Step A: POST /auth/login/send-otp should trigger sendOtp when user is found', async () => {
      const mockResult = {
        message: 'OTP sent to your registered mobile number.',
        data: {
          requiresOtp: true,
          purpose: 'LOGIN',
          mobile: '+919876543210',
          mobileMasked: '******3210',
          expiresIn: 300,
          resendAvailableIn: 60,
        },
      };

      authService.loginSendOtp!.mockResolvedValueOnce(mockResult as any);

      const result = await controller.loginSendOtp(
        { mobileNumber: '+919876543210' },
        {} as any,
      );

      expect(result).toEqual(mockResult);
      expect(authService.loginSendOtp).toHaveBeenCalledTimes(1);
    });

    it('Step B: POST /auth/login/verify-otp should verify OTP, generate tokens, and return user profile', async () => {
      const mockResult = {
        message: 'Login successful.',
        data: {
          user: {
            userId: 'user-uuid-1',
            mobileNumber: '+919876543210',
            roles: ['STUDENT'],
          },
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 900,
        },
      };

      authService.loginVerifyOtp!.mockResolvedValueOnce(mockResult as any);

      const mockRes = {
        cookie: jest.fn(),
      } as any;

      const result = await controller.loginVerifyOtp(
        { mobileNumber: '+919876543210', otp: '12345' },
        {} as any,
        mockRes,
      );

      expect(result).toEqual(mockResult);
      expect(authService.loginVerifyOtp).toHaveBeenCalledWith(
        { mobileNumber: '+919876543210', otp: '12345' },
        expect.anything(),
      );
    });
  });
});
