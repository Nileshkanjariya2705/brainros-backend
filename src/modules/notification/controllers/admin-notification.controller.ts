import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { NotificationService } from '../services/notification.service';
import { NotificationTemplateService } from '../services/notification-template.service';
import {
  CreateNotificationTemplateDto,
  NotificationFilterDto,
} from '../dto/notification.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminNotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getNotifications(@Query() filter: NotificationFilterDto) {
    return this.notificationService.getNotifications(filter);
  }

  @Get('templates')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getTemplates() {
    return this.prisma.notificationTemplate.findMany({
      orderBy: [{ notificationType: 'asc' }, { version: 'desc' }],
    });
  }

  @Post('templates')
  @Roles('SUPER_ADMIN')
  async createTemplate(@Body() dto: CreateNotificationTemplateDto) {
    return this.templateService.saveTemplate(dto);
  }
}
