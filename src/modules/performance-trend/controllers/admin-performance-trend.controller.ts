import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StudentTrendService } from '../services/student-trend.service';
import { GetTrendsQueryDto } from '../dto/performance-trend.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('students/:studentId/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminPerformanceTrendController {
  constructor(private readonly trendService: StudentTrendService) {}

  /**
   * Admin inspection of student performance trends
   */
  @Get('trends')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getStudentTrends(
    @Param('studentId') studentId: string,
    @Query() query: GetTrendsQueryDto,
  ) {
    return this.trendService.getStudentTrends(studentId, query);
  }
}
