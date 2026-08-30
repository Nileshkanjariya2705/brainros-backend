import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RankQueryService } from '../services/rank-query.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('attempts/:attemptId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RankController {
  constructor(private readonly rankQueryService: RankQueryService) {}

  /**
   * Get student's calculated ranks & percentiles (Overall, State, District, School, Category).
   * Fast indexed read from persisted RankSnapshot.
   */
  @Get('ranks')
  getMyRanks(@Param('attemptId') attemptId: string, @CurrentUser() user: any) {
    return this.rankQueryService.getMyRanks(attemptId, user.userId);
  }

  /**
   * Get student's predicted rank range
   */
  @Get('rank-prediction')
  getRankPrediction(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.rankQueryService.getRankPrediction(attemptId, user.userId);
  }
}
