import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, PoolConfig } from 'pg';
import { parse } from 'pg-connection-string';
import { InfrastructureStateService } from '../../common/infrastructure/infrastructure-state.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private _isReady = false;
  private retryCount = 0;
  private retryTimeout: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(private readonly infrastructureState: InfrastructureStateService) {
    const dbUrl = process.env.DATABASE_URL || '';
    let poolConfig: PoolConfig = {};
    if (dbUrl) {
      const parsed = parse(dbUrl);
      poolConfig = {
        ...parsed,
        host: parsed.host || undefined,
        port: parsed.port ? parseInt(parsed.port, 10) : undefined,
        user: parsed.user || undefined,
        password: parsed.password || undefined,
        database: parsed.database || undefined,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        max: 10,
        ssl:
          dbUrl.includes('supabase.com') ||
          dbUrl.includes('aivencloud.com') ||
          dbUrl.includes('sslmode=') ||
          process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : undefined,
      };
    }

    const pool = new Pool(poolConfig);

    // Guard against unhandled EventEmitter error termination when database drops connection
    pool.on('error', (err) => {
      this._isReady = false;
      this.infrastructureState.setDatabaseState('DOWN', err.message);
      this.logger.warn(`[Database] PostgreSQL connection pool error: ${err.message}`);
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });

    this.pool = pool;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  onModuleInit() {
    this.infrastructureState.setDatabaseState('CONNECTING');
    // Startup connection attempt with 5s hard timeout; runs non-blocking so app.listen() is never delayed
    this.connectWithRetry(true).catch((err) => {
      this.logger.error(`[STARTUP] Uncaught error during DB initialization: ${err.message}`);
    });
  }

  private async connectWithTimeout(timeoutMs = 5000): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Database connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([this.$connect(), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async connectWithRetry(isStartup = false): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      await this.connectWithTimeout(5000);
      this._isReady = true;
      this.retryCount = 0;
      this.infrastructureState.setDatabaseState('UP');
      this.logger.log('[Database] Connected successfully via Prisma (pg adapter).');
    } catch (error: any) {
      this._isReady = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.infrastructureState.setDatabaseState('DOWN', errorMsg);

      if (isStartup) {
        this.logger.error(
          `[STARTUP] PostgreSQL database connection failed after 5s (${errorMsg}) - continuing startup in degraded mode.`,
          error instanceof Error ? error.stack : undefined,
        );
      } else {
        this.logger.warn(
          `[Database] Background reconnect attempt #${this.retryCount} failed: ${errorMsg}. Will retry in background...`,
        );
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    this.retryCount++;
    // Exponential backoff capped at 30s: 2s, 3s, 4.5s, 6.75s, 10s... max 30s
    const delay = Math.min(
      Math.floor(2000 * Math.pow(1.5, Math.min(this.retryCount - 1, 7))),
      30000,
    );

    this.logger.log(
      `[Database] Scheduling background reconnection attempt #${this.retryCount} in ${Math.round(delay / 1000)}s...`,
    );

    this.retryTimeout = setTimeout(() => {
      this.connectWithRetry(false);
    }, delay);
  }

  /**
   * Diagnostic probe to verify live database query capability
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.$queryRawUnsafe('SELECT 1');
      return true;
    } catch (err: any) {
      this._isReady = false;
      this.infrastructureState.setDatabaseState('DOWN', err.message);
      return false;
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    try {
      await this.$disconnect();
    } catch {}
    try {
      await this.pool.end();
    } catch {}
    this.logger.log('[Database] Disconnected cleanly.');
  }
}