import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { ActiveTimingState } from '../interfaces/time-analysis.interface';

@Injectable()
export class RedisTimingStore {
  private readonly logger = new Logger(RedisTimingStore.name);
  private readonly DEFAULT_ACTIVE_TTL_SECONDS = 3600 * 6; // 6 hours
  private readonly EVENT_DEDUP_TTL_SECONDS = 3600 * 2; // 2 hours

  constructor(private readonly redisService: RedisService) {}

  private getActiveKey(attemptId: string): string {
    return `attempt:${attemptId}:active-timing`;
  }

  private getEventKey(attemptId: string, eventId: string): string {
    return `attempt:${attemptId}:event:${eventId}`;
  }

  private getAnalysisCacheKey(attemptId: string, version: number): string {
    return `attempt:${attemptId}:time-analysis:${version}`;
  }

  /**
   * Get currently active question timing state from Redis
   */
  async getActiveTiming(attemptId: string): Promise<ActiveTimingState | null> {
    try {
      const raw = await this.redisService.get(this.getActiveKey(attemptId));
      if (!raw) return null;
      return JSON.parse(raw) as ActiveTimingState;
    } catch (err) {
      this.logger.error(
        `Error reading active timing state for attempt '${attemptId}': ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Set active question timing state in Redis
   */
  async setActiveTiming(
    attemptId: string,
    state: ActiveTimingState,
    ttlSeconds: number = this.DEFAULT_ACTIVE_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redisService.set(
        this.getActiveKey(attemptId),
        JSON.stringify(state),
        ttlSeconds,
      );
    } catch (err) {
      this.logger.error(
        `Error setting active timing state for attempt '${attemptId}': ${err.message}`,
      );
    }
  }

  /**
   * Clear active question timing state from Redis
   */
  async clearActiveTiming(attemptId: string): Promise<void> {
    try {
      await this.redisService.del(this.getActiveKey(attemptId));
    } catch (err) {
      this.logger.error(
        `Error clearing active timing state for attempt '${attemptId}': ${err.message}`,
      );
    }
  }

  /**
   * Atomic Event Deduplication:
   * Returns true if event is newly recorded, false if already processed.
   */
  async recordProcessedEvent(
    attemptId: string,
    eventId: string,
  ): Promise<boolean> {
    if (!eventId) return true;
    try {
      const key = this.getEventKey(attemptId, eventId);
      const existing = await this.redisService.get(key);
      if (existing) {
        return false; // duplicate event
      }
      await this.redisService.set(key, '1', this.EVENT_DEDUP_TTL_SECONDS);
      return true;
    } catch (err) {
      this.logger.warn(
        `Event deduplication check failed for '${eventId}': ${err.message}`,
      );
      return true; // fail-open so legitimate attempts proceed
    }
  }

  /**
   * Cache finalized time analysis report in Redis
   */
  async getCachedAnalysis(
    attemptId: string,
    version: number = 1,
  ): Promise<any | null> {
    try {
      const raw = await this.redisService.get(
        this.getAnalysisCacheKey(attemptId, version),
      );
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  async setCachedAnalysis(
    attemptId: string,
    version: number,
    data: any,
    ttlSeconds: number = 86400 * 7,
  ): Promise<void> {
    try {
      await this.redisService.set(
        this.getAnalysisCacheKey(attemptId, version),
        JSON.stringify(data),
        ttlSeconds,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to cache time analysis for attempt '${attemptId}': ${err.message}`,
      );
    }
  }

  async invalidateAnalysisCache(
    attemptId: string,
    version: number = 1,
  ): Promise<void> {
    try {
      await this.redisService.del(this.getAnalysisCacheKey(attemptId, version));
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate time analysis cache for attempt '${attemptId}': ${err.message}`,
      );
    }
  }
}
