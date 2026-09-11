import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ExportRegistryService, ExportRequestContext } from '../services/export-registry.service';
import { PdfExportService } from '../services/pdf-export.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PDF_EXPORT_QUEUE_NAME, PdfExportJobData } from '../processors/pdf-export.processor';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface ExportPdfDto {
  resource: string;
  filters?: Record<string, any>;
  search?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
  mode?: 'all' | 'current';
  page?: number;
  pageSize?: number;
}

@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportController {
  private readonly logger = new Logger(ExportController.name);
  private readonly tempDir = path.join(process.cwd(), 'temp', 'pdf-exports');

  constructor(
    private readonly exportRegistryService: ExportRegistryService,
    private readonly pdfExportService: PdfExportService,
    @InjectQueue(PDF_EXPORT_QUEUE_NAME) private readonly pdfQueue: Queue<PdfExportJobData>,
  ) {}

  /**
   * POST /exports/pdf
   * Centralized endpoint to export filtered records as PDF
   */
  @Post('pdf')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'GENERAL_MANAGER', 'INSTITUTION_ADMIN', 'MANAGER', 'FINANCE')
  async exportPdf(
    @Body() dto: ExportPdfDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') userRoles: string[],
    @Res() res: any,
  ) {
    if (!dto.resource) {
      throw new BadRequestException('Resource parameter is required.');
    }

    const exportId = uuidv4();
    const limit = dto.mode === 'current' ? dto.pageSize || 20 : 2000;
    const offset = dto.mode === 'current' && dto.page ? (dto.page - 1) * limit : 0;

    const context: ExportRequestContext = {
      resource: dto.resource,
      filters: dto.filters || {},
      search: dto.search,
      sort: dto.sort,
      limit,
      offset,
      userId,
      userRoles: userRoles || [],
    };

    // First resolve configuration and check count
    const resolved = await this.exportRegistryService.resolveExport(context);

    // If large dataset (> 500 records), offload to BullMQ async pipeline
    if (resolved.totalCount > 500 && dto.mode !== 'current') {
      const job = await this.pdfQueue.add('generate-pdf', {
        exportId,
        context,
      });

      return res.status(HttpStatus.ACCEPTED).json({
        statusCode: HttpStatus.ACCEPTED,
        isAsync: true,
        jobId: String(job.id),
        exportId,
        totalRecords: resolved.totalCount,
        message: `Export is processing in the background for ${resolved.totalCount} records. You will receive real-time progress.`,
      });
    }

    // Synchronous generation for manageable datasets
    const buffer = await this.pdfExportService.generateTablePdf(resolved.options);

    const dateStr = new Date().toISOString().split('T')[0];
    const safeTitle = dto.resource.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filename = `${safeTitle}-${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);

    return res.status(HttpStatus.OK).send(buffer);
  }

  /**
   * GET /exports/pdf/download/:exportId
   * Authenticated download endpoint for asynchronously generated PDF exports
   */
  @Get('pdf/download/:exportId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'GENERAL_MANAGER', 'INSTITUTION_ADMIN', 'MANAGER', 'FINANCE')
  async downloadExport(
    @Param('exportId') exportId: string,
    @Res() res: any,
  ) {
    const filePath = path.join(this.tempDir, `${exportId}.pdf`);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('The requested export file was not found or has expired.');
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="export-${exportId.slice(0, 8)}.pdf"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(filePath);
    return stream.pipe(res);
  }
}
