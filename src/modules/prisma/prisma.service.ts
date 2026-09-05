import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private _isReady = false;

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      max: 5,
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
    // Fire-and-forget: do NOT await this here.
    // Awaiting would block Nest's bootstrap (and app.listen())
    // until the DB responds, which is what caused the
    // "did not call listen() within 3 seconds" failure.
    this.$connect()
      .then(() => {
        this._isReady = true;
        this.logger.log('Database connected successfully via Prisma (pg adapter).');
      })
      .catch((error) => {
        this._isReady = false;
        this.logger.error(
          'Failed to connect to database during initialization',
          error instanceof Error ? error.stack : String(error),
        );
        // Intentionally NOT rethrown - a slow/failed initial connection
        // should not crash the whole app or block listen().
        // Prisma will also lazily retry on the next actual query.
      });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('Database disconnected.');
  }
}