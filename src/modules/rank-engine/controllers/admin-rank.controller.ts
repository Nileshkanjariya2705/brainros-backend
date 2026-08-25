import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RankGenerationService } from '../services/rank-generation.service';
import { RankQueryService } from '../services/rank-query.service';
import { GenerateRankDto, QueryLeaderboardDto } from '../dto/rank-engine.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('exams/:examId/ranks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminRankController {
  constructor(
    private readonly rankGenerationService: RankGenerationService,
    private readonly rankQueryService: RankQueryService,
  ) {}

  /**
   * Trigger batch rank & percentile generation for an exam population
   */
  @Post('generate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  generateRanks(@Param('examId') examId: string, @Body() dto: GenerateRankDto) {
    return this.rankGenerationService.generateRanks({
      examId,
      examVersionId: dto.examVersionId,
      snapshotVersion: dto.snapshotVersion,
      forceRegenerate: dto.forceRegenerate,
    });
  }

  /**
   * Check RankSnapshot status and summary aggregates
   */
  @Get('status')
  getSnapshotStatus(
    @Param('examId') examId: string,
    @Query('version') version?: number,
  ) {
    return this.rankQueryService.getSnapshotStatus(examId, version ? Number(version) : undefined);
  }

  /**
   * Get paginated leaderboard for the exam (by Overall, State, District, School, Category)
   */
  @Get('leaderboard')
  getLeaderboard(
    @Param('examId') examId: string,
    @Query() query: QueryLeaderboardDto,
  ) {
    return this.rankQueryService.getAdminLeaderboard(examId, query);
  }
}
