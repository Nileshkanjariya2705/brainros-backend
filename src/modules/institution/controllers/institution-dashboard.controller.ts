import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { InstitutionDashboardService } from '../services/institution-dashboard.service';
import { InstitutionAccessService } from '../services/institution-access.service';
import {
  DashboardQueryDto,
  InstituteStudentQueryDto,
  InstituteRankQueryDto,
  ExportInstituteStudentsDto,
} from '../dto/institution.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('institutions/me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstitutionDashboardController {
  constructor(
    private readonly dashboardService: InstitutionDashboardService,
    private readonly accessService: InstitutionAccessService,
  ) {}

  /**
   * GET /institutions/me/dashboard
   * Main dynamic KPI summary for authenticated institute
   */
  @Get('dashboard')
  async getDashboard(
    @CurrentUser() user: any,
    @Query() query: DashboardQueryDto,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.dashboardService.getDashboardSummary(institution.id, query);
  }

  /**
   * GET /institutions/me/students
   * Server-side paginated, searchable, sorted, filterable student directory
   */
  @Get('students')
  async getStudents(
    @CurrentUser() user: any,
    @Query() query: InstituteStudentQueryDto,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.dashboardService.getStudents(institution.id, query);
  }

  /**
   * GET /institutions/me/admission-years
   * Distinct admission years present in DB for authenticated institute
   */
  @Get('admission-years')
  async getAdmissionYears(@CurrentUser() user: any) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    const years = await this.dashboardService.getAdmissionYears(institution.id);
    return { data: years };
  }

  /**
   * GET /institutions/me/students/export
   * Stream Excel (.xlsx) of institute students matching active filters
   */
  @Get('students/export')
  async exportStudents(
    @CurrentUser() user: any,
    @Query() query: ExportInstituteStudentsDto,
    @Res() res: Response,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    const { buffer, fileName } =
      await this.dashboardService.exportStudentsExcel(institution.id, query);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });

    res.status(HttpStatus.OK).send(buffer);
  }

  /**
   * GET /institutions/me/rankings/exams
   * List of exams completed by institute students for rank selection
   */
  @Get('rankings/exams')
  async getRankExams(@CurrentUser() user: any) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    const exams = await this.dashboardService.getExamsWithResults(
      institution.id,
    );
    return { data: exams };
  }

  /**
   * GET /institutions/me/rankings
   * Scoped rank list for selected exam
   */
  @Get('rankings')
  async getRankings(
    @CurrentUser() user: any,
    @Query() query: InstituteRankQueryDto,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.dashboardService.getRankings(institution.id, query);
  }

  /**
   * GET /institutions/me/batches/:batchId/analytics
   * Specific batch analytics
   */
  @Get('batches/:batchId/analytics')
  async getBatchAnalytics(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.dashboardService.getBatchAnalytics(batchId);
  }
}
