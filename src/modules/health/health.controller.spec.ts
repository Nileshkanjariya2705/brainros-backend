import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { InfrastructureStateService } from '../../common/infrastructure/infrastructure-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let infraState: InfrastructureStateService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(async () => {
    infraState = new InfrastructureStateService();
    mockPrisma = { isReady: true };
    mockRedis = { isReady: true, isEnabled: true };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: InfrastructureStateService, useValue: infraState },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return ok when database and redis are healthy', () => {
    infraState.setDatabaseState('UP');
    infraState.setRedisState('UP');

    const result = controller.getHealth();
    expect(result.status).toBe('ok');
    expect(result.application).toBe('up');
    expect(result.database).toBe('up');
    expect(result.redis).toBe('up');
    expect(typeof result.uptime).toBe('number');
    expect(typeof result.timestamp).toBe('string');
  });

  it('should return degraded when database is down', () => {
    infraState.setDatabaseState('DOWN', 'Connection refused');
    infraState.setRedisState('UP');

    const result = controller.getHealth();
    expect(result.status).toBe('degraded');
    expect(result.application).toBe('up');
    expect(result.database).toBe('down');
  });

  it('should return disabled for redis when REDIS_ENABLED=false', () => {
    infraState.setDatabaseState('UP');
    infraState.setRedisState('DISABLED');

    const result = controller.getHealth();
    expect(result.status).toBe('ok');
    expect(result.redis).toBe('disabled');
  });

  it('should return degraded when redis is down and enabled', () => {
    infraState.setDatabaseState('UP');
    infraState.setRedisState('DOWN', 'Redis connection timeout');

    const result = controller.getHealth();
    expect(result.status).toBe('degraded');
    expect(result.redis).toBe('down');
  });

  it('should return 503 for readiness check when database is down', () => {
    mockPrisma.isReady = false;
    infraState.setDatabaseState('DOWN', 'DB down');

    const mockRes = { status: jest.fn() };
    const result = controller.getReadiness(mockRes);

    expect(result.status).toBe('degraded');
    expect(result.ready).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(503);
  });
});
