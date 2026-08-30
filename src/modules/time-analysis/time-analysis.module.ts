import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RedisTimingStore } from './stores/redis-timing.store';
import { QuestionTimingService } from './services/question-timing.service';
import { TimeAnalysisService } from './services/time-analysis.service';
import { QuestionTimingController } from './controllers/question-timing.controller';
import { TimeAnalysisController } from './controllers/time-analysis.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [QuestionTimingController, TimeAnalysisController],
  providers: [RedisTimingStore, QuestionTimingService, TimeAnalysisService],
  exports: [QuestionTimingService, TimeAnalysisService, RedisTimingStore],
})
export class TimeAnalysisModule {}
