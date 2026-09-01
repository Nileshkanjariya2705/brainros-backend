import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResultController } from './result.controller';
import { ExamPublicationController } from './controllers/exam-publication.controller';
import { ResultService } from './result.service';
import { AnalysisEngineService } from './services/analysis-engine.service';
import { ResultReadinessService } from './services/result-readiness.service';
import { ExamPublicationService } from './services/exam-publication.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RankEngineModule } from '../rank-engine/rank-engine.module';
import {
  EVALUATION_QUEUE_NAME,
  ANALYTICS_QUEUE_NAME,
  RANKING_QUEUE_NAME,
} from './interfaces/result-lifecycle.interface';
import { NOTIFICATION_QUEUE_NAME } from '../notification/interfaces/exam-notification-job.interface';
import { EvaluationProcessor } from './processors/evaluation.processor';
import { AnalyticsProcessor } from './processors/analytics.processor';
import { RankingProcessor } from './processors/ranking.processor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RankEngineModule,
    BullModule.registerQueue(
      { name: EVALUATION_QUEUE_NAME },
      { name: ANALYTICS_QUEUE_NAME },
      { name: RANKING_QUEUE_NAME },
      { name: NOTIFICATION_QUEUE_NAME },
    ),
  ],
  controllers: [ResultController, ExamPublicationController],
  providers: [
    ResultService,
    AnalysisEngineService,
    ResultReadinessService,
    ExamPublicationService,
    EvaluationProcessor,
    AnalyticsProcessor,
    RankingProcessor,
  ],
  exports: [
    ResultService,
    AnalysisEngineService,
    ResultReadinessService,
    ExamPublicationService,
  ],
})
export class ResultModule {}
