import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportService } from '../services/report.service';
import { StorageService } from '../services/storage.service';
import { InstitutionAccessService } from '../services/institution-access.service';
import { CreateReportJobDto } from '../dto/institution.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('institutions/me/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly storageService: StorageService,
    private readonly accessService: InstitutionAccessService,
  ) {}

  @Post()
  async requestReport(
    @CurrentUser() user: any,
    @Body() dto: CreateReportJobDto,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.reportService.createReportJob(institution.id, user.userId, dto);
  }

  @Get()
  async listReports(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { institution } = await this.accessService.getMyInstitution(
      user.userId,
    );
    return this.reportService.listReports(institution.id, page, limit);
  }

  @Get(':reportJobId')
  async getReportStatus(
    @CurrentUser() user: any,
    @Param('reportJobId') reportJobId: string,
  ) {
    await this.accessService.assertCanAccessReport(user.userId, reportJobId);
    return this.reportService.getReportStatus(reportJobId);
  }

  @Get('download-local/:fileName')
  async downloadLocalFile(
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const buffer = await this.storageService.getLocalFile(fileName);
    if (!buffer) {
      throw new NotFoundException(`File '${fileName}' not found on storage.`);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader(
      'Content-Type',
      fileName.endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.send(buffer);
  }
}
