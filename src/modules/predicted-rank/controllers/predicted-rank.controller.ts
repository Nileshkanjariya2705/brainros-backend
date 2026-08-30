import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { PredictionQueryService } from '../services/prediction-query.service';
import { PredictionGeneratorService } from '../services/prediction-generator.service';
import { GeneratePredictionDto } from '../dto/predicted-rank.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('attempts/:attemptId/predicted-rank')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PredictedRankController {
  constructor(
    private readonly queryService: PredictionQueryService,
    private readonly generator: PredictionGeneratorService,
  ) {}

  /**
   * Get predicted rank for an attempt (Student / Authorized access)
   */
  @Get()
  getPrediction(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.queryService.getStudentPrediction(attemptId, user.userId);
  }

  /**
   * Explicitly generate or recalculate predicted rank
   */
  @Post('generate')
  generatePrediction(
    @Param('attemptId') attemptId: string,
    @Body() dto: GeneratePredictionDto,
  ) {
    return this.generator.generatePrediction(attemptId, {
      configVersion: dto.configVersion,
      forceRegenerate: dto.forceRegenerate,
    });
  }
}
