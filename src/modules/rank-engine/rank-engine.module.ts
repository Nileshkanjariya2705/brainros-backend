import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RankingCandidateEligibilityService } from './services/ranking-candidate-eligibility.service';
import { TieBreakService } from './services/tie-break.service';
import { PercentileService } from './services/percentile.service';
import { PredictionService } from './services/prediction.service';
import { RankGenerationService } from './services/rank-generation.service';
import { RankQueryService } from './services/rank-query.service';
import { RankController } from './controllers/rank.controller';
import { AdminRankController } from './controllers/admin-rank.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [RankController, AdminRankController],
  providers: [
    RankingCandidateEligibilityService,
    TieBreakService,
    PercentileService,
    PredictionService,
    RankGenerationService,
    RankQueryService,
  ],
  exports: [
    RankGenerationService,
    RankQueryService,
    TieBreakService,
    PercentileService,
  ],
})
export class RankEngineModule {}
