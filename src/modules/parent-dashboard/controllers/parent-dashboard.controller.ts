import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ParentStudentAccessService } from '../services/parent-student-access.service';
import { ParentDashboardService } from '../services/parent-dashboard.service';
import { GetTrendsQueryDto } from '../../performance-trend/dto/performance-trend.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('parents/me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParentDashboardController {
  constructor(
    private readonly accessService: ParentStudentAccessService,
    private readonly dashboardService: ParentDashboardService,
  ) {}

  /**
   * List all students linked to the authenticated parent
   */
  @Get('students')
  getMyStudents(@CurrentUser() user: any) {
    return this.accessService.getAuthorizedStudents(user.userId);
  }

  /**
   * Multi-student high-level summary overview
   */
  @Get('dashboard')
  getMultiStudentOverview(@CurrentUser() user: any) {
    return this.dashboardService.getMultiStudentOverview(user.userId);
  }

  /**
   * Comprehensive detailed dashboard for a specific linked student
   */
  @Get('students/:studentId/dashboard')
  getStudentDashboard(
    @CurrentUser() user: any,
    @Param('studentId') studentId: string,
  ) {
    return this.dashboardService.getStudentDashboard(user.userId, studentId);
  }

  /**
   * Historical trends for a linked student
   */
  @Get('students/:studentId/trends')
  getStudentTrends(
    @CurrentUser() user: any,
    @Param('studentId') studentId: string,
    @Query() query: GetTrendsQueryDto,
  ) {
    return this.dashboardService.getStudentTrends(user.userId, studentId, query);
  }

  /**
   * Subject performance breakdown for a linked student
   */
  @Get('students/:studentId/subjects')
  async getStudentSubjects(
    @CurrentUser() user: any,
    @Param('studentId') studentId: string,
  ) {
    const dash = await this.dashboardService.getStudentDashboard(user.userId, studentId);
    return dash.subjects;
  }

  /**
   * Rank and percentile summary for a linked student
   */
  @Get('students/:studentId/rank')
  async getStudentRank(
    @CurrentUser() user: any,
    @Param('studentId') studentId: string,
  ) {
    const dash = await this.dashboardService.getStudentDashboard(user.userId, studentId);
    return dash.rank;
  }

  /**
   * Parent-safe recommendations for a linked student
   */
  @Get('students/:studentId/recommendations')
  async getStudentRecommendations(
    @CurrentUser() user: any,
    @Param('studentId') studentId: string,
  ) {
    const dash = await this.dashboardService.getStudentDashboard(user.userId, studentId);
    return dash.recommendations;
  }
}
