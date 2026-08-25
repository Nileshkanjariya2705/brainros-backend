import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { StrategyAnalyzerService } from '../services/strategy-analyzer.service';
import { RecalculateStrategyDto } from '../dto/strategy-rule.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('attempts/:attemptId/strategy')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StrategyAnalysisController {
  constructor(private readonly analyzerService: StrategyAnalyzerService) {}

  /**
   * Get full Attempt Strategy Analysis
   */
  @Get()
  getStrategyAnalysis(
    @Param('attemptId') attemptId: string,
    @Query('version') version?: number,
  ) {
    return this.analyzerService.generateStrategyAnalysis(
      attemptId,
      version ? Number(version) : 1,
    );
  }

  /**
   * Get computed Strategy Metrics
   */
  @Get('metrics')
  getStrategyMetrics(@Param('attemptId') attemptId: string) {
    return this.analyzerService.getMetrics(attemptId);
  }

  /**
   * Get Strategy Recommendations
   */
  @Get('recommendations')
  getStrategyRecommendations(@Param('attemptId') attemptId: string) {
    return this.analyzerService.getRecommendations(attemptId);
  }

  /**
   * Recalculate strategy analysis (Admin / Super Admin)
   */
  @Post('recalculate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  recalculateStrategyAnalysis(
    @Param('attemptId') attemptId: string,
    @Body() dto: RecalculateStrategyDto,
  ) {
    return this.analyzerService.recalculateStrategyAnalysis(
      attemptId,
      dto.strategyVersion || 1,
    );
  }
}
