import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('SessionService (Database Session Management)', () => {
  let service: SessionService;
  let prismaMock: any;
  let configMock: any;

  beforeEach(async () => {
    prismaMock = {
      loginSession: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'sess-123',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        })),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sess-123' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation((cb) => {
        if (typeof cb === 'function') return cb(prismaMock);
        return Promise.all(cb);
      }),
    };

    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'SESSION_EXPIRY_DAYS') return 30;
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  it('1. should create session with calculated expiry date', async () => {
    const session = await service.createSession({
      userId: 'user-1',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(session.id).toBe('sess-123');
    expect(prismaMock.loginSession.create).toHaveBeenCalled();
  });

  it('2. should verify session is valid when active and not revoked', async () => {
    prismaMock.loginSession.findUnique.mockResolvedValue({
      id: 'sess-123',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 86400 * 1000),
      revokedAt: null,
    });

    const isValid = await service.isSessionValid('sess-123');
    expect(isValid).toBe(true);
  });

  it('3. should return false if session is revoked', async () => {
    prismaMock.loginSession.findUnique.mockResolvedValue({
      id: 'sess-123',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 86400 * 1000),
      revokedAt: new Date(),
    });

    const isValid = await service.isSessionValid('sess-123');
    expect(isValid).toBe(false);
  });

  it('4. should return false if session has expired', async () => {
    prismaMock.loginSession.findUnique.mockResolvedValue({
      id: 'sess-123',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 86400 * 1000),
      revokedAt: null,
    });

    const isValid = await service.isSessionValid('sess-123');
    expect(isValid).toBe(false);
  });

  it('5. should revoke session and all its refresh tokens', async () => {
    await service.revokeSession('sess-123');

    expect(prismaMock.loginSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-123' },
      }),
    );
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'sess-123', revokedAt: null },
      }),
    );
  });
});
