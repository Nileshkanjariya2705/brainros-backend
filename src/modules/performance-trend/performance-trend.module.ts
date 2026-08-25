import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { TrendDataProviderService } from './services/trend-data-provider.service';
import { TrendAggregationService } from './services/trend-aggregation.service';
import { MockComparisonService } from './services/mock-comparison.service';
import { StudentTrendService } from './services/student-trend.service';
import { PerformanceTrendController } from './controllers/performance-trend.controller';
import { AdminPerformanceTrendController } from './controllers/admin-performance-trend.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [PerformanceTrendController, AdminPerformanceTrendController],
  providers: [
    TrendDataProviderService,
    TrendAggregationService,
    MockComparisonService,
    StudentTrendService,
  ],
  exports: [
    TrendDataProviderService,
    TrendAggregationService,
    MockComparisonService,
    StudentTrendService,
  ],
})
export class PerformanceTrendModule {}
