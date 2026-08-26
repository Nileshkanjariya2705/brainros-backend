import { Test, TestingModule } from '@nestjs/testing';
import { TokenService } from './token.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SecurityEventService } from './security-event.service';
import { UnauthorizedException } from '@nestjs/common';

describe('TokenService (Access Token, Refresh Token Rotation & Reuse Detection)', () => {
  let tokenService: TokenService;
  let prismaMock: any;
  let jwtServiceMock: any;
  let configServiceMock: any;
  let securityEventServiceMock: any;

  beforeEach(async () => {
    jwtServiceMock = {
      sign: jest.fn().mockReturnValue('signed-jwt-access-token'),
      verify: jest.fn().mockReturnValue({ sub: 'user-1', sessionId: 'sess-1', type: 'access' }),
    };

    prismaMock = {
      refreshToken: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rt-new', ...data })),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'rt-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      loginSession: {
        update: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return Promise.all(cb);
      }),
    };

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_EXPIRATION') return '15m';
        if (key === 'JWT_REFRESH_EXPIRATION') return '7d';
        return null;
      }),
    };

    securityEventServiceMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: SecurityEventService, useValue: securityEventServiceMock },
      ],
    }).compile();

    tokenService = module.get<TokenService>(TokenService);
  });

  describe('1. Token Generation', () => {
    it('should generate short-lived JWT access token and store hashed refresh token', async () => {
      const result = await tokenService.generateTokens('user-123', 'session-456');

      expect(result.accessToken).toBe('signed-jwt-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900); // 15 mins

      // Ensure raw token is NEVER saved, only SHA-256 hash
      expect(prismaMock.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            sessionId: 'session-456',
            tokenHash: tokenService.hashToken(result.refreshToken),
          }),
        }),
      );
    });
  });

  describe('2. Refresh Token Rotation', () => {
    it('should successfully rotate refresh token, link replacedByTokenId, and return new pair', async () => {
      const rawOldToken = 'valid-raw-refresh-token';
      const oldHash = tokenService.hashToken(rawOldToken);

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-old-id',
        tokenHash: oldHash,
        userId: 'user-123',
        sessionId: 'session-456',
        revokedAt: null,
        expiresAt: futureDate,
        user: { isActive: true, status: 'ACTIVE' },
        session: { id: 'session-456', revokedAt: null, expiresAt: futureDate },
      });

      const res = await tokenService.refreshAccessTokens(rawOldToken);

      expect(res.accessToken).toBe('signed-jwt-access-token');
      expect(res.refreshToken).toBeDefined();
      expect(res.refreshToken).not.toBe(rawOldToken);

      // Verify rotation audit: old token revoked and linked
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-old-id', revokedAt: null },
        }),
      );
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-old-id' },
          data: { replacedByTokenId: 'rt-new' },
        }),
      );
      expect(securityEventServiceMock.log).toHaveBeenCalledWith('TOKEN_REFRESHED', expect.any(Object));
    });
  });

  describe('3. Refresh Token Reuse Detection', () => {
    it('should detect reuse of already-revoked token, revoke entire session family, and throw 401', async () => {
      const rawReusedToken = 'already-rotated-token';
      const reusedHash = tokenService.hashToken(rawReusedToken);

      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-revoked-id',
        tokenHash: reusedHash,
        userId: 'user-123',
        sessionId: 'session-456',
        revokedAt: new Date(Date.now() - 60000), // Already revoked!
        expiresAt: new Date(Date.now() + 86400000),
        user: { isActive: true, status: 'ACTIVE' },
        session: { id: 'session-456' },
      });

      await expect(tokenService.refreshAccessTokens(rawReusedToken)).rejects.toThrow(
        UnauthorizedException,
      );

      // Verify security logging of REFRESH_REUSE_DETECTED
      expect(securityEventServiceMock.log).toHaveBeenCalledWith(
        'REFRESH_REUSE_DETECTED',
        expect.objectContaining({
          userId: 'user-123',
          metadata: expect.objectContaining({ sessionId: 'session-456' }),
        }),
      );
    });
  });

  describe('4. Concurrency & Race Condition Prevention', () => {
    it('should reject second concurrent refresh attempt on the same token (atomic update returns 0)', async () => {
      const rawToken = 'concurrent-test-token';
      const hash = tokenService.hashToken(rawToken);

      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-concurrent-id',
        tokenHash: hash,
        userId: 'user-123',
        sessionId: 'session-456',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        user: { isActive: true, status: 'ACTIVE' },
        session: { id: 'session-456', revokedAt: null, expiresAt: new Date(Date.now() + 86400000) },
      });

      // Simulate race condition where atomic updateMany returned count: 0 because another worker won
      prismaMock.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(tokenService.refreshAccessTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('5. Revocation on Logout', () => {
    it('should revoke refresh token on logout', async () => {
      const rawToken = 'logout-token';
      const hash = tokenService.hashToken(rawToken);

      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-logout-id',
        tokenHash: hash,
        sessionId: 'session-logout',
        revokedAt: null,
      });

      const sessionId = await tokenService.revokeRefreshToken(rawToken);

      expect(sessionId).toBe('session-logout');
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-logout-id' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
