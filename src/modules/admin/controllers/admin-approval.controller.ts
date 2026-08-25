import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApprovalWorkflowService } from '../approval/services/approval-workflow.service';
import {
  SubmitApprovalDto,
  ApproveRequestDto,
  RejectRequestDto,
  CancelRequestDto,
  BulkApproveDto,
  ApprovalFilterDto,
} from '../dto/admin.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('admin/approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminApprovalController {
  constructor(private readonly approvalService: ApprovalWorkflowService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getApprovalQueue(@Query() filter: ApprovalFilterDto) {
    return this.approvalService.getApprovalRequests(filter);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getApprovalById(@Param('id') id: string) {
    return this.approvalService.getApprovalById(id);
  }

  @Post('submit')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async submitForApproval(
    @CurrentUser() user: any,
    @Body() dto: SubmitApprovalDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.approvalService.submit(dto, user.userId, ip, ua);
  }

  @Post(':id/approve')
  @Roles('SUPER_ADMIN')
  async approveRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.approvalService.approve(id, user.userId, dto, ip, ua);
  }

  @Post(':id/reject')
  @Roles('SUPER_ADMIN')
  async rejectRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.approvalService.reject(id, user.userId, dto, ip, ua);
  }

  @Post(':id/cancel')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async cancelRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CancelRequestDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.approvalService.cancel(id, user.userId, dto, ip, ua);
  }

  @Post('bulk-approve')
  @Roles('SUPER_ADMIN')
  async bulkApprove(
    @CurrentUser() user: any,
    @Body() dto: BulkApproveDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];
    return this.approvalService.bulkApprove(
      dto.approvalRequestIds,
      user.userId,
      dto.comment,
      ip,
      ua,
    );
  }
}
