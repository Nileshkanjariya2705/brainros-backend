import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResultController } from './result.controller';
import { ExamPublicationController } from './controllers/exam-publication.controller';
import { ResultService } from './result.service';
import { AnalysisEngineService } from './services/analysis-engine.service';
import { ResultReadinessService } from './services/result-readiness.service';
import { ResultAccessService } from './services/result-access.service';
import { ExamPublicationService } from './services/exam-publication.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RankEngineModule } from '../rank-engine/rank-engine.module';
import { ExamSchedulingModule } from '../exam-scheduling/exam-scheduling.module';
import {
  EVALUATION_QUEUE_NAME,
  ANALYTICS_QUEUE_NAME,
  RANKING_QUEUE_NAME,
  RECONCILIATION_QUEUE_NAME,
  EXAM_WINDOW_END_QUEUE_NAME,
} from './interfaces/result-lifecycle.interface';
import { NOTIFICATION_QUEUE_NAME } from '../notification/interfaces/exam-notification-job.interface';
import { EvaluationProcessor } from './processors/evaluation.processor';
import { AnalyticsProcessor } from './processors/analytics.processor';
import { RankingProcessor } from './processors/ranking.processor';
import { ResultReconciliationProcessor } from './processors/result-reconciliation.processor';
import { ExamWindowEndProcessor } from './processors/exam-window-end.processor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RankEngineModule,
    forwardRef(() => ExamSchedulingModule),
    BullModule.registerQueue(
      { name: EVALUATION_QUEUE_NAME },
      { name: ANALYTICS_QUEUE_NAME },
      { name: RANKING_QUEUE_NAME },
      { name: NOTIFICATION_QUEUE_NAME },
      { name: RECONCILIATION_QUEUE_NAME },
      { name: EXAM_WINDOW_END_QUEUE_NAME },
    ),
  ],
  controllers: [ResultController, ExamPublicationController],
  providers: [
    ResultService,
    AnalysisEngineService,
    ResultReadinessService,
    ResultAccessService,
    ExamPublicationService,
    EvaluationProcessor,
    AnalyticsProcessor,
    RankingProcessor,
    ResultReconciliationProcessor,
    ExamWindowEndProcessor,
  ],
  exports: [
    ResultService,
    AnalysisEngineService,
    ResultReadinessService,
    ResultAccessService,
    ExamPublicationService,
    BullModule,
  ],
})
export class ResultModule {}
