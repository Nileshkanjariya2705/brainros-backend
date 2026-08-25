import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PerformanceTrendModule } from '../performance-trend/performance-trend.module';
import { ParentStudentAccessService } from './services/parent-student-access.service';
import { ParentDashboardService } from './services/parent-dashboard.service';
import { ParentDashboardController } from './controllers/parent-dashboard.controller';

@Module({
  imports: [PrismaModule, RedisModule, PerformanceTrendModule],
  controllers: [ParentDashboardController],
  providers: [ParentStudentAccessService, ParentDashboardService],
  exports: [ParentStudentAccessService, ParentDashboardService],
})
export class ParentDashboardModule {}
