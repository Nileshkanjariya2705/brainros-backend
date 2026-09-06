import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InfrastructureStateService } from '../../common/infrastructure/infrastructure-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller(['health', 'status'])
export class HealthController {
  constructor(
    private readonly infrastructureState: InfrastructureStateService,
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Primary Liveness & Dependency Health:
   * Accessible at GET /health, GET /status, and GET /health/status.
   * Returns HTTP 200 as long as the application process is running.
   * Responds instantly (<1ms) without blocking on database or external I/O.
   */
  @Get(['', 'status'])
  getHealth() {
    const report = this.infrastructureState.getHealthReport();
    return {
      status: report.status,
      application: report.application,
      database: report.database,
      redis: report.redis,
      queue: report.queue,
      uptime: report.uptime,
      timestamp: report.timestamp,
    };
  }

  /**
   * Minimal lightweight liveness check
   */
  @Get('live')
  getLiveness() {
    return {
      status: 'ok',
      application: 'up',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Diagnostic Readiness check:
   * Returns HTTP 200 when mandatory core services (Database) are operational.
   * Returns HTTP 503 when the database is unavailable and traffic cannot be served.
   */
  @Get('ready')
  getReadiness(@Res({ passthrough: true }) res: any) {
    const isDbAlive = this.prismaService.isReady;
    const report = this.infrastructureState.getHealthReport();

    const responsePayload = {
      status: isDbAlive ? 'ok' : 'degraded',
      application: 'up',
      ready: isDbAlive,
      services: {
        database: {
          status: report.database,
          connected: isDbAlive,
        },
        redis: {
          status: report.redis,
          connected: this.redisService.isReady,
          enabled: this.redisService.isEnabled,
        },
        queue: {
          status: report.queue,
        },
      },
      uptime: report.uptime,
      timestamp: report.timestamp,
      ...(report.details ? { details: report.details } : {}),
    };

    if (!isDbAlive) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return responsePayload;
  }
}
