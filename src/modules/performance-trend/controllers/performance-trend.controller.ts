import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StudentTrendService } from '../services/student-trend.service';
import { MockComparisonService } from '../services/mock-comparison.service';
import { GetTrendsQueryDto, CompareMocksQueryDto } from '../dto/performance-trend.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('students/me/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PerformanceTrendController {
  constructor(
    private readonly trendService: StudentTrendService,
    private readonly comparisonService: MockComparisonService,
  ) {}

  /**
   * Get student's historical performance trends & chart data
   */
  @Get('trends')
  getMyTrends(
    @CurrentUser() user: any,
    @Query() query: GetTrendsQueryDto,
  ) {
    return this.trendService.getStudentTrends(user.userId, query);
  }

  /**
   * Compare two mock attempts side-by-side
   */
  @Get('compare')
  compareMocks(
    @CurrentUser() user: any,
    @Query() query: CompareMocksQueryDto,
  ) {
    return this.comparisonService.compareMocks(
      query.attemptA,
      query.attemptB,
      user.userId,
    );
  }
}
