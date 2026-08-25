import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis | null = null;
  
  // In-memory database fallback to handle offline development environment
  private memoryDb = new Map<string, { value: string; expiresAt: number }>();
  private useMemoryFallback = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = this.configService.get<number>('REDIS_PORT') || 6379;
    const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;

    this.redisClient = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        // Fast fail on connection retry to trigger fallback immediately
        if (times > 1) {
          return null;
        }
        return 1000;
      },
    });

    // Handle connection failures gracefully
    this.redisClient.on('error', (err) => {
      if (!this.useMemoryFallback) {
        this.logger.warn(`Redis connection failed: ${err.message}. Falling back to in-memory store.`);
        this.useMemoryFallback = true;
      }
    });

    this.redisClient.connect().catch((err) => {
      if (!this.useMemoryFallback) {
        this.logger.warn(`Redis connection failed: ${err.message}. Falling back to in-memory store.`);
        this.useMemoryFallback = true;
      }
    });
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => {});
    }
  }

  getClient(): Redis | null {
    return this.redisClient;
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemoryFallback) {
      const item = this.memoryDb.get(key);
      if (!item) return null;
      if (Date.now() > item.expiresAt) {
        this.memoryDb.delete(key);
        return null;
      }
      return item.value;
    }
    return this.redisClient!.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.useMemoryFallback) {
      const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : Infinity;
      this.memoryDb.set(key, { value, expiresAt });
      return;
    }
    try {
      if (ttlSeconds) {
        await this.redisClient!.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.redisClient!.set(key, value);
      }
    } catch (err) {
      this.logger.warn(`Redis set failed: ${err.message}. Saving in-memory instead.`);
      this.useMemoryFallback = true;
      const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : Infinity;
      this.memoryDb.set(key, { value, expiresAt });
    }
  }

  async del(key: string): Promise<void> {
    if (this.useMemoryFallback) {
      this.memoryDb.delete(key);
      return;
    }
    try {
      await this.redisClient!.del(key);
    } catch (err) {
      this.logger.warn(`Redis del failed: ${err.message}. Deleting from memory instead.`);
      this.useMemoryFallback = true;
      this.memoryDb.delete(key);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (this.useMemoryFallback) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      const matched: string[] = [];
      for (const [k, v] of this.memoryDb.entries()) {
        if (regex.test(k) && Date.now() <= v.expiresAt) {
          matched.push(k);
        }
      }
      return matched;
    }
    try {
      return (await this.redisClient?.keys(pattern)) || [];
    } catch {
      return [];
    }
  }
}
