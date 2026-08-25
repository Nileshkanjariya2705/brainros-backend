import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StrategyMetricCalculatorService } from './services/strategy-metric-calculator.service';
import { StrategyRuleEngineService } from './services/strategy-rule-engine.service';
import { StrategyAnalyzerService } from './services/strategy-analyzer.service';
import { StrategyRuleAdminService } from './services/strategy-rule-admin.service';
import { StrategyAnalysisController } from './controllers/strategy-analysis.controller';
import { StrategyRuleAdminController } from './controllers/strategy-rule-admin.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [StrategyAnalysisController, StrategyRuleAdminController],
  providers: [
    StrategyMetricCalculatorService,
    StrategyRuleEngineService,
    StrategyAnalyzerService,
    StrategyRuleAdminService,
  ],
  exports: [
    StrategyAnalyzerService,
    StrategyRuleEngineService,
    StrategyMetricCalculatorService,
    StrategyRuleAdminService,
  ],
})
export class AttemptStrategyModule {}
