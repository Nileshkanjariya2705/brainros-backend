import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { FeatureActivationService } from '../services/feature-activation.service';
import { SetFeatureActivationDto } from '../dto/calendar.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('admin/feature-activations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeatureActivationController {
  constructor(private readonly featureService: FeatureActivationService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getFeatureActivations() {
    return this.featureService.getAllActivations();
  }

  @Post()
  @Roles('SUPER_ADMIN')
  async setFeatureActivation(
    @CurrentUser() user: any,
    @Body() dto: SetFeatureActivationDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.featureService.setFeatureActivation(dto, user.userId, ip, ua);
  }
}
