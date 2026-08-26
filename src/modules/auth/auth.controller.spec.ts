import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceMock: any;
  let configServiceMock: any;

  beforeEach(async () => {
    authServiceMock = {
      verifyPasswordlessLoginOtp: jest.fn().mockResolvedValue({
        data: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          user: { userId: 'u1' },
        },
      }),
      refreshSession: jest.fn().mockResolvedValue({
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: 900,
        },
      }),
      logout: jest.fn().mockResolvedValue({ message: 'Logged out successfully.' }),
      logoutAll: jest.fn().mockResolvedValue({ message: 'All sessions logged out successfully.' }),
    };

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should set HttpOnly cookie on successful OTP login verification', async () => {
    const mockRes: any = { cookie: jest.fn() };
    const mockReq: any = { ip: '127.0.0.1' };

    const result = await controller.verifyPasswordlessLoginOtp(
      { loginRequestId: 'LOGIN-1', otp: '12345' },
      mockReq,
      mockRes,
    );

    expect(authServiceMock.verifyPasswordlessLoginOtp).toHaveBeenCalled();
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'test-refresh-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result.data.accessToken).toBe('test-access-token');
  });

  it('should refresh session from HttpOnly cookie and set new rotated cookie', async () => {
    const mockRes: any = { cookie: jest.fn() };
    const mockReq: any = { cookies: { refreshToken: 'cookie-refresh-token' } };

    const result = await controller.refreshSession('', '', mockReq, mockRes);

    expect(authServiceMock.refreshSession).toHaveBeenCalledWith('cookie-refresh-token', mockReq);
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'new-refresh-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result.data.accessToken).toBe('new-access-token');
  });

  it('should clear refresh cookie on logout', async () => {
    const mockRes: any = { clearCookie: jest.fn() };
    const mockReq: any = { cookies: { refreshToken: 'active-cookie' } };

    await controller.logout('', '', mockReq, mockRes);

    expect(authServiceMock.logout).toHaveBeenCalledWith('active-cookie', mockReq);
    expect(mockRes.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
