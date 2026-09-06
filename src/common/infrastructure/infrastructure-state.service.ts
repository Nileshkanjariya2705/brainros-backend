import { Injectable, Logger } from '@nestjs/common';

export type DependencyState = 'UP' | 'DOWN' | 'DISABLED' | 'CONNECTING';

export interface HealthReport {
  status: 'ok' | 'degraded';
  application: 'up';
  database: 'up' | 'down';
  redis: 'up' | 'down' | 'disabled';
  queue: 'up' | 'down' | 'disabled';
  uptime: number;
  timestamp: string;
  details?: {
    database?: string;
    redis?: string;
    queue?: string;
  };
}

@Injectable()
export class InfrastructureStateService {
  private readonly logger = new Logger(InfrastructureStateService.name);

  private databaseState: DependencyState = 'CONNECTING';
  private redisState: DependencyState = 'CONNECTING';
  private queueState: DependencyState = 'CONNECTING';

  private databaseError?: string;
  private redisError?: string;
  private queueError?: string;

  private lastStateChange: Record<string, number> = {
    database: Date.now(),
    redis: Date.now(),
    queue: Date.now(),
  };

  constructor() {
    const envVal = process.env.REDIS_ENABLED;
    const isRedisEnabled = envVal !== undefined ? (envVal === 'true' || envVal === '1' || envVal === 'yes') : true;
    if (!isRedisEnabled) {
      this.redisState = 'DISABLED';
      this.queueState = 'DISABLED';
    }
  }

  isDatabaseUp(): boolean {
    return this.databaseState === 'UP';
  }

  isRedisUp(): boolean {
    return this.redisState === 'UP';
  }

  isQueueUp(): boolean {
    return this.queueState === 'UP';
  }

  getDatabaseState(): DependencyState {
    return this.databaseState;
  }

  getRedisState(): DependencyState {
    return this.redisState;
  }

  getQueueState(): DependencyState {
    return this.queueState;
  }

  setDatabaseState(state: DependencyState, error?: string): void {
    if (this.databaseState !== state) {
      this.logger.log(
        `[Database] State transitioned from ${this.databaseState} to ${state}${error ? ` (Reason: ${error})` : ''}`,
      );
      this.databaseState = state;
      this.lastStateChange.database = Date.now();
    }
    this.databaseError = error;
  }

  setRedisState(state: DependencyState, error?: string): void {
    if (this.redisState !== state) {
      this.logger.log(
        `[Redis] State transitioned from ${this.redisState} to ${state}${error ? ` (Reason: ${error})` : ''}`,
      );
      this.redisState = state;
      this.lastStateChange.redis = Date.now();
    }
    this.redisError = error;
  }

  setQueueState(state: DependencyState, error?: string): void {
    if (this.queueState !== state) {
      this.logger.log(
        `[Queue] State transitioned from ${this.queueState} to ${state}${error ? ` (Reason: ${error})` : ''}`,
      );
      this.queueState = state;
      this.lastStateChange.queue = Date.now();
    }
    this.queueError = error;
  }

  getHealthReport(): HealthReport {
    const isDbUp = this.databaseState === 'UP';
    const isRedisHealthy = this.redisState === 'UP' || this.redisState === 'DISABLED';
    const isOverallOk = isDbUp && isRedisHealthy;

    const mapState = (state: DependencyState): 'up' | 'down' | 'disabled' => {
      switch (state) {
        case 'UP':
          return 'up';
        case 'DISABLED':
          return 'disabled';
        case 'DOWN':
        case 'CONNECTING':
        default:
          return 'down';
      }
    };

    return {
      status: isOverallOk ? 'ok' : 'degraded',
      application: 'up',
      database: isDbUp ? 'up' : 'down',
      redis: mapState(this.redisState),
      queue: mapState(this.queueState),
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      details: {
        ...(this.databaseError ? { database: this.databaseError } : {}),
        ...(this.redisError ? { redis: this.redisError } : {}),
        ...(this.queueError ? { queue: this.queueError } : {}),
      },
    };
  }
}
