import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminDashboardService } from '../dashboard/services/admin-dashboard.service';
import { AdminUserSearchDto } from '../dto/admin.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminUserSearchController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async searchUsers(@Query() query: AdminUserSearchDto) {
    return this.dashboardService.searchUsers(query);
  }
}
