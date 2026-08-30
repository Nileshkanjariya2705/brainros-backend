import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminDashboardService } from '../dashboard/services/super-admin-dashboard.service';
import { SuperAdminAnalyticsFilterDto } from '../dto/super-admin-dashboard.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('super-admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SuperAdminDashboardController {
  constructor(
    private readonly dashboardService: SuperAdminDashboardService,
  ) {}

  @Get('overview')
  async getOverview(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getOverview(filter);
  }

  @Get('daily-registrations')
  async getDailyRegistrations(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getDailyRegistrations(filter);
  }

  @Get('state-registrations')
  async getStateRegistrations(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getStateRegistrations(filter);
  }

  @Get('district-registrations')
  async getDistrictRegistrations(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getDistrictRegistrations(filter);
  }

  @Get('institution-registrations')
  async getInstitutionRegistrations(
    @Query() filter: SuperAdminAnalyticsFilterDto,
  ) {
    return this.dashboardService.getInstitutionRegistrations(filter);
  }

  @Get('exam-targets')
  async getExamTargets(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getExamTargetAnalytics(filter);
  }

  @Get('language-preferences')
  async getLanguagePreferences(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getLanguagePreferenceAnalytics(filter);
  }

  @Get('revenue')
  async getRevenue(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getRevenueAnalytics(filter);
  }

  @Get('conversion-rate')
  async getConversionRate(@Query() filter: SuperAdminAnalyticsFilterDto) {
    return this.dashboardService.getConversionRateAnalytics(filter);
  }

  @Get('sales-agent-performance')
  async getSalesAgentPerformance(
    @Query() filter: SuperAdminAnalyticsFilterDto,
  ) {
    return this.dashboardService.getSalesAgentPerformance(filter);
  }

  @Get('filters-metadata')
  async getFiltersMetadata() {
    return this.dashboardService.getFiltersMetadata();
  }
}
