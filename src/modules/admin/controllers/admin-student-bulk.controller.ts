import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { StudentBulkRegistrationService } from '../services/student-bulk-registration.service';
import { BulkStudentUploadQueryDto } from '../dto/student-bulk-upload.dto';

@Controller('admin/students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminStudentBulkController {
  constructor(
    private readonly bulkRegistrationService: StudentBulkRegistrationService,
  ) {}

  /**
   * Download sample student registration CSV/Excel template
   */
  @Get('bulk-template')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async downloadTemplate(
    @Query('format') format: 'csv' | 'xlsx' = 'xlsx',
    @Res() res: Response,
  ) {
    const { buffer, fileName, mimeType } =
      await this.bulkRegistrationService.generateTemplate(format);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  /**
   * Upload and stage/validate student spreadsheet
   */
  @Post('bulk-upload')
  @Roles('SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  async uploadStudents(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Please select a CSV or Excel file to upload.');
    }

    const actor = {
      userId: req.user?.userId || req.user?.id,
      email: req.user?.email,
    };

    return this.bulkRegistrationService.uploadAndValidate(file, actor);
  }

  /**
   * List previous bulk student upload batches
   */
  @Get('bulk-uploads')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getUploadHistory(@Query() query: BulkStudentUploadQueryDto) {
    return this.bulkRegistrationService.getUploadHistory(
      query.page,
      query.limit,
      query.status,
    );
  }

  /**
   * Get validation preview and row details for a batch
   */
  @Get('bulk-upload/:id/preview')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getUploadPreview(
    @Param('id') uploadId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('filterStatus') filterStatus?: 'ALL' | 'VALID' | 'INVALID',
  ) {
    return this.bulkRegistrationService.getUploadPreview(
      uploadId,
      Number(page) || 1,
      Number(limit) || 20,
      filterStatus,
    );
  }

  /**
   * Confirm and register valid students in the batch
   */
  @Post('bulk-upload/:id/confirm')
  @Roles('SUPER_ADMIN')
  async confirmRegistration(
    @Param('id') uploadId: string,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      email: req.user?.email,
    };

    return this.bulkRegistrationService.confirmAndRegisterStudents(
      uploadId,
      actor,
    );
  }

  /**
   * Download error report for a batch
   */
  @Get('bulk-upload/:id/error-report')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async downloadErrorReport(
    @Param('id') uploadId: string,
    @Query('format') format: 'csv' | 'xlsx' = 'xlsx',
    @Res() res: Response,
  ) {
    const { buffer, fileName, mimeType } =
      await this.bulkRegistrationService.generateErrorReport(uploadId, format);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
