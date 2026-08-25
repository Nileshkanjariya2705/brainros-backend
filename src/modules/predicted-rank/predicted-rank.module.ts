import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { HistoricalDatasetService } from './services/historical-dataset.service';
import { HistoricalDatasetSelectorService } from './services/historical-dataset-selector.service';
import { HistoricalInterpolationModel } from './services/historical-interpolation.model';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { PredictionEvaluationService } from './services/prediction-evaluation.service';
import { PredictionQueryService } from './services/prediction-query.service';
import { PredictedRankController } from './controllers/predicted-rank.controller';
import { AdminPredictedRankController } from './controllers/admin-predicted-rank.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [PredictedRankController, AdminPredictedRankController],
  providers: [
    HistoricalDatasetService,
    HistoricalDatasetSelectorService,
    HistoricalInterpolationModel,
    PredictionGeneratorService,
    PredictionEvaluationService,
    PredictionQueryService,
  ],
  exports: [
    HistoricalDatasetService,
    HistoricalDatasetSelectorService,
    HistoricalInterpolationModel,
    PredictionGeneratorService,
    PredictionEvaluationService,
    PredictionQueryService,
  ],
})
export class PredictedRankModule {}
