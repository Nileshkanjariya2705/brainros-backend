import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { TrendDataProviderService } from './trend-data-provider.service';
import { TrendAggregationService } from './trend-aggregation.service';
import { GetTrendsQueryDto } from '../dto/performance-trend.dto';
import { PerformanceTrendsResponse } from '../interfaces/performance-trend.interface';

@Injectable()
export class StudentTrendService {
  private readonly logger = new Logger(StudentTrendService.name);

  constructor(
    private readonly dataProvider: TrendDataProviderService,
    private readonly aggregationService: TrendAggregationService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Get aggregated performance trends for a student with Redis caching
   */
  async getStudentTrends(
    studentId: string,
    filters: GetTrendsQueryDto,
  ): Promise<PerformanceTrendsResponse> {
    const filterHash = `${filters.examType || 'ALL'}_${filters.examId || 'ALL'}_${filters.limit || 10}_${filters.from || ''}_${filters.to || ''}`;
    const cacheKey = `student:${studentId}:analytics:trends:${filterHash}`;

    // 1. Check Redis Cache
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.logger.debug(
        `Cache hit for student '${studentId}' performance trends`,
      );
      return JSON.parse(cached);
    }

    // 2. Load attempts from database
    const rawAttempts = await this.dataProvider.loadStudentMockAttempts(
      studentId,
      filters,
    );

    // 3. Aggregate trends
    const response = this.aggregationService.aggregateTrends(rawAttempts);

    // 4. Cache in Redis for 15 minutes
    await this.redisService.set(cacheKey, JSON.stringify(response), 900);

    return response;
  }

  /**
   * Invalidate student trend cache
   */
  async invalidateStudentCache(studentId: string) {
    const pattern = `student:${studentId}:analytics:trends:*`;
    const keys = await this.redisService.keys(pattern);
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }
}
