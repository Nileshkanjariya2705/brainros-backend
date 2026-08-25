import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from '../audit/services/audit-log.service';
import { AuditLogFilterDto } from '../dto/admin.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminAuditLogController {
  constructor(private readonly auditService: AuditLogService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getAuditLogs(@Query() filter: AuditLogFilterDto) {
    return this.auditService.getAuditLogs(filter);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getAuditLogById(@Param('id') id: string) {
    return this.auditService.getAuditLogById(id);
  }
}
