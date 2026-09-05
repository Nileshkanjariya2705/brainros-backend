import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /** Max number of connection attempts before giving up */
  private static readonly MAX_RETRIES = 3;
  /** Delay between retry attempts in milliseconds */
  private static readonly RETRY_DELAY_MS = 3000;

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });
  }

  async onModuleInit() {
    // Fix 4: Log masked DATABASE_URL so we can verify the target host in logs
    this.logDatabaseTarget();

    // Fix 2: Retry connection up to MAX_RETRIES times with delay
    for (let attempt = 1; attempt <= PrismaService.MAX_RETRIES; attempt++) {
      try {
        this.logger.log(
          `Database connection attempt ${attempt}/${PrismaService.MAX_RETRIES}...`,
        );
        await this.$connect();
        this.logger.log(
          `Database connected successfully on attempt ${attempt}.`,
        );
        return; // Connected — exit early
      } catch (error: any) {
        this.logger.error(
          `Connection attempt ${attempt}/${PrismaService.MAX_RETRIES} failed: ${error.message}`,
        );

        if (attempt < PrismaService.MAX_RETRIES) {
          this.logger.warn(
            `Retrying in ${PrismaService.RETRY_DELAY_MS / 1000}s...`,
          );
          await this.sleep(PrismaService.RETRY_DELAY_MS);
        }
      }
    }

    // Fix 5: All retries exhausted — log fatal but do NOT throw/crash
    this.logger.error(
      `═══════════════════════════════════════════════════════════`,
    );
    this.logger.error(
      `FATAL: All ${PrismaService.MAX_RETRIES} database connection attempts failed.`,
    );
    this.logger.error(
      `The application will start in DEGRADED state — database queries will fail.`,
    );
    this.logger.error(
      `Check DATABASE_URL, network connectivity, and database server status.`,
    );
    this.logger.error(
      `═══════════════════════════════════════════════════════════`,
    );
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Database disconnected.');
    } catch {
      // Ignore disconnect errors during shutdown
    }
  }

  /**
   * Logs the DATABASE_URL target host with credentials masked
   * so we can verify the correct database is being targeted.
   */
  private logDatabaseTarget(): void {
    const rawUrl = process.env.DATABASE_URL || '';
    try {
      const url = new URL(rawUrl);
      const masked = `${url.protocol}//${url.username ? '****' : ''}@${url.host}${url.pathname}`;
      this.logger.log(`Database target: ${masked}`);
    } catch {
      this.logger.warn(
        `DATABASE_URL is not set or is not a valid URL. Connection will likely fail.`,
      );
    }
  }

  /** Simple async sleep helper */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
