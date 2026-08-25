import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InstitutionDashboardService } from '../services/institution-dashboard.service';
import { InstitutionAccessService } from '../services/institution-access.service';
import { DashboardQueryDto } from '../dto/institution.dto';
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

  @Get('dashboard')
  async getDashboard(
    @CurrentUser() user: any,
    @Query() query: DashboardQueryDto,
  ) {
    const { institution } = await this.accessService.getMyInstitution(user.userId);
    return this.dashboardService.getDashboardSummary(institution.id, query);
  }

  @Get('batches/:batchId/analytics')
  async getBatchAnalytics(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
  ) {
    await this.accessService.assertCanAccessBatch(user.userId, batchId);
    return this.dashboardService.getBatchAnalytics(batchId);
  }
}
