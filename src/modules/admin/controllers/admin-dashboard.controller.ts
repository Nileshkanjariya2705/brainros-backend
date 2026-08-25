import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminDashboardService } from '../dashboard/services/admin-dashboard.service';
import { AdminDashboardFilterDto } from '../dto/admin.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getDashboard(@Query() filter: AdminDashboardFilterDto) {
    return this.dashboardService.getDashboardOverview(filter);
  }
}
