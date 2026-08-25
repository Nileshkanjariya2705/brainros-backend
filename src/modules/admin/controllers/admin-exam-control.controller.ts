import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminHighRiskService } from '../services/admin-high-risk.service';
import {
  ActivateExamDto,
  DeactivateExamDto,
  BulkActivateExamsDto,
} from '../dto/admin.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('admin/exams')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminExamControlController {
  constructor(private readonly highRiskService: AdminHighRiskService) {}

  @Post(':examId/activate')
  @Roles('SUPER_ADMIN')
  async activateExam(
    @CurrentUser() user: any,
    @Param('examId') examId: string,
    @Body() dto: ActivateExamDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.highRiskService.activateExam(
      examId,
      user.userId,
      dto.idempotencyKey,
      ip,
      ua,
    );
  }

  @Post(':examId/deactivate')
  @Roles('SUPER_ADMIN')
  async deactivateExam(
    @CurrentUser() user: any,
    @Param('examId') examId: string,
    @Body() dto: DeactivateExamDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.highRiskService.deactivateExam(
      examId,
      user.userId,
      dto.reason,
      ip,
      ua,
    );
  }

  @Post('bulk-activate')
  @Roles('SUPER_ADMIN')
  async bulkActivateExams(
    @CurrentUser() user: any,
    @Body() dto: BulkActivateExamsDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.highRiskService.bulkActivateExams(
      dto.examIds,
      user.userId,
      dto.idempotencyKey,
      ip,
      ua,
    );
  }
}
