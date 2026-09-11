import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { JobProgressModule } from '../job-progress/job-progress.module';
import { EXAM_CACHE_PREPARATION_QUEUE_NAME } from './interfaces/exam-cache.interface';
import { ExamCacheService } from './services/exam-cache.service';
import { ExamCacheProcessor } from './processors/exam-cache.processor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    ConfigModule,
    JobProgressModule,
    BullModule.registerQueue({
      name: EXAM_CACHE_PREPARATION_QUEUE_NAME,
    }),
  ],
  providers: [ExamCacheService, ExamCacheProcessor],
  exports: [ExamCacheService, BullModule],
})
export class ExamCacheModule {}
