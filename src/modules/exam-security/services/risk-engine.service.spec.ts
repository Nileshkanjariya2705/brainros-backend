import { Test, TestingModule } from '@nestjs/testing';
import { RiskEngineService } from './risk-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AttemptRiskLevel, SecurityActionType } from '@prisma/client';

describe('RiskEngineService', () => {
  let service: RiskEngineService;
  let prisma: PrismaService;

  const mockPrismaService = {
    attempt: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    attemptEvent: {
      findMany: jest.fn(),
    },
  };

  const mockRedisService = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskEngineService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<RiskEngineService>(RiskEngineService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateEventWeight', () => {
    it('should assign 0 weight to benign events like LANGUAGE_CHANGED, NETWORK_ONLINE', () => {
      expect(service.calculateEventWeight('LANGUAGE_CHANGED')).toBe(0);
      expect(service.calculateEventWeight('NETWORK_OFFLINE')).toBe(0);
      expect(service.calculateEventWeight('NETWORK_ONLINE')).toBe(0);
      expect(service.calculateEventWeight('PAGE_REFRESH')).toBe(0);
    });

    it('should scale TAB_HIDDEN weight by duration (short vs long)', () => {
      expect(service.calculateEventWeight('TAB_HIDDEN', 2)).toBe(1);
      expect(service.calculateEventWeight('TAB_HIDDEN', 10)).toBe(3);
      expect(service.calculateEventWeight('TAB_HIDDEN', 30)).toBe(8);
    });

    it('should assign high weights to suspicious events like MULTIPLE_SESSION, DEVTOOLS', () => {
      expect(service.calculateEventWeight('DEVTOOLS_SHORTCUT_DETECTED')).toBe(10);
      expect(service.calculateEventWeight('MULTIPLE_SESSION_DETECTED')).toBe(20);
      expect(service.calculateEventWeight('API_TAMPERING_DETECTED')).toBe(25);
    });
  });

  describe('resolveRiskLevel', () => {
    it('should resolve levels correctly based on thresholds', () => {
      expect(service.resolveRiskLevel(0)).toBe(AttemptRiskLevel.LOW);
      expect(service.resolveRiskLevel(8)).toBe(AttemptRiskLevel.LOW);
      expect(service.resolveRiskLevel(12)).toBe(AttemptRiskLevel.MEDIUM);
      expect(service.resolveRiskLevel(25)).toBe(AttemptRiskLevel.HIGH);
      expect(service.resolveRiskLevel(45)).toBe(AttemptRiskLevel.CRITICAL);
    });
  });

  describe('evaluateAttemptSecurity (False Positive Protection)', () => {
    it('should not flag attempt for a single accidental blur or short tab switch', async () => {
      mockPrismaService.attempt.findUnique.mockResolvedValue({
        id: 'att-1',
        isFlagged: false,
        securityProfile: {
          detectTabSwitch: true,
          maxTabSwitches: 3,
          warningThreshold: 2,
          fullscreenRequired: false,
        },
      });

      mockPrismaService.attemptEvent.findMany.mockResolvedValue([
        { eventType: 'TAB_HIDDEN', duration: 2 },
        { eventType: 'WINDOW_BLUR', duration: 1 },
      ]);

      mockPrismaService.attempt.update.mockResolvedValue({});

      const result = await service.evaluateAttemptSecurity('att-1');

      expect(result.riskScore).toBeLessThan(10);
      expect(result.riskLevel).toBe(AttemptRiskLevel.LOW);
      expect(result.isFlagged).toBe(false);
      expect(result.action).toBe(SecurityActionType.ALLOW);
    });

    it('should warn and flag when threshold is significantly exceeded', async () => {
      mockPrismaService.attempt.findUnique.mockResolvedValue({
        id: 'att-2',
        isFlagged: false,
        securityProfile: {
          detectTabSwitch: true,
          maxTabSwitches: 2,
          fullscreenRequired: true,
          maxFullscreenExits: 1,
        },
      });

      mockPrismaService.attemptEvent.findMany.mockResolvedValue([
        { eventType: 'TAB_HIDDEN', duration: 25 },
        { eventType: 'TAB_HIDDEN', duration: 30 },
        { eventType: 'TAB_HIDDEN', duration: 40 },
        { eventType: 'FULLSCREEN_EXITED', duration: 0 },
        { eventType: 'FULLSCREEN_EXITED', duration: 0 },
        { eventType: 'DEVTOOLS_SHORTCUT_DETECTED', duration: 0 },
      ]);

      mockPrismaService.attempt.update.mockResolvedValue({});

      const result = await service.evaluateAttemptSecurity('att-2');

      expect(result.riskScore).toBeGreaterThanOrEqual(20);
      expect([AttemptRiskLevel.HIGH, AttemptRiskLevel.CRITICAL]).toContain(result.riskLevel);
      expect(result.isFlagged).toBe(true);
      expect(result.action).toBe(SecurityActionType.FLAG);
    });
  });
});
