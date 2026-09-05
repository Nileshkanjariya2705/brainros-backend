import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis | null = null;
  private _isReady = false;

  // In-memory database fallback to handle offline/disconnected environment
  private memoryDb = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly configService: ConfigService) {}

  public get isReady(): boolean {
    return this._isReady;
  }

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');

    const commonOptions: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false, // Prevents queuing commands when disconnected which causes connectionCloseHandler errors
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    };

    if (redisUrl) {
      this.redisClient = new Redis(redisUrl, {
        ...commonOptions,
        tls: redisUrl.startsWith('rediss://')
          ? { rejectUnauthorized: false }
          : undefined,
      });
    } else {
      const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
      const port = this.configService.get<number>('REDIS_PORT') || 6379;
      const password =
        this.configService.get<string>('REDIS_PASSWORD') || undefined;

      this.redisClient = new Redis({
        ...commonOptions,
        host,
        port,
        password,
      });
    }

    // Attach all event listeners immediately to prevent unhandled errors
    this.redisClient.on('error', (err) => {
      this._isReady = false;
      this.logger.warn(`Redis connection error: ${err.message}`);
    });

    this.redisClient.on('connect', () => {
      this._isReady = true;
      this.logger.log('Redis connected successfully.');
    });

    this.redisClient.on('ready', () => {
      this._isReady = true;
      this.logger.log('Redis is ready to accept commands.');
    });

    this.redisClient.on('close', () => {
      this._isReady = false;
      this.logger.warn('Redis connection closed.');
    });

    this.redisClient.on('reconnecting', (delay) => {
      this._isReady = false;
      this.logger.warn(`Redis reconnecting in ${delay}ms...`);
    });

    // Fire-and-forget connection attempt
    this.redisClient.connect().catch((err) => {
      this._isReady = false;
      this.logger.warn(
        `Initial Redis connection failed: ${err.message}. Operating with in-memory fallback.`,
      );
    });
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        this.redisClient.disconnect();
      }
    }
  }

  getClient(): Redis | null {
    return this.redisClient;
  }

  private getFromMemory(key: string): string | null {
    const item = this.memoryDb.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.memoryDb.delete(key);
      return null;
    }
    return item.value;
  }

  private setInMemory(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity;
    this.memoryDb.set(key, { value, expiresAt });
  }

  private deleteFromMemory(key: string): void {
    this.memoryDb.delete(key);
  }

  private getKeysFromMemory(pattern: string): string[] {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const matched: string[] = [];
    for (const [k, v] of this.memoryDb.entries()) {
      if (regex.test(k) && Date.now() <= v.expiresAt) {
        matched.push(k);
      }
    }
    return matched;
  }

  async get(key: string): Promise<string | null> {
    if (!this._isReady || !this.redisClient) {
      return this.getFromMemory(key);
    }
    try {
      return await this.redisClient.get(key);
    } catch (err: any) {
      this.logger.warn(
        `Redis get failed for '${key}': ${err.message}. Using in-memory fallback.`,
      );
      return this.getFromMemory(key);
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this._isReady || !this.redisClient) {
      this.setInMemory(key, value, ttlSeconds);
      return;
    }
    try {
      if (ttlSeconds) {
        await this.redisClient.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.redisClient.set(key, value);
      }
    } catch (err: any) {
      this.logger.warn(
        `Redis set failed for '${key}': ${err.message}. Saving in-memory instead.`,
      );
      this.setInMemory(key, value, ttlSeconds);
    }
  }

  async del(key: string): Promise<void> {
    if (!this._isReady || !this.redisClient) {
      this.deleteFromMemory(key);
      return;
    }
    try {
      await this.redisClient.del(key);
    } catch (err: any) {
      this.logger.warn(
        `Redis del failed for '${key}': ${err.message}. Deleting from memory instead.`,
      );
      this.deleteFromMemory(key);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this._isReady || !this.redisClient) {
      return this.getKeysFromMemory(pattern);
    }
    try {
      return (await this.redisClient.keys(pattern)) || [];
    } catch (err: any) {
      this.logger.warn(
        `Redis keys failed for pattern '${pattern}': ${err.message}. Searching memory instead.`,
      );
      return this.getKeysFromMemory(pattern);
    }
  }
}
