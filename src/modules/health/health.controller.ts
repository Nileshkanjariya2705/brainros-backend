import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Basic liveness check:
   * Returns 200 OK immediately without querying the database or Redis.
   * Ensures hosting platform health checks (Hostinger, Kubernetes, AWS) always succeed while the process is alive.
   */
  @Get()
  getLiveness() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Diagnostic readiness check:
   * Inspects database and Redis connectivity without blocking requests.
   */
  @Get('ready')
  getReadiness() {
    const dbReady = this.prismaService.isReady;
    const redisReady = this.redisService.isReady;

    return {
      status: dbReady ? 'ok' : 'degraded',
      services: {
        database: {
          status: dbReady ? 'connected' : 'disconnected',
        },
        redis: {
          status: redisReady ? 'connected' : 'in-memory-fallback',
        },
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
