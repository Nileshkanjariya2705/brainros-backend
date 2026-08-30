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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ExamPaperImportService } from '../services/exam-paper-import.service';
import { ExamService } from '../exam.service';
import {
  ExamImportFormatEnum,
  ExamImportFilterDto,
} from '../dto/exam-manager.dto';
import { ExamFilterDto } from '../dto/exam.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('admin/exam-manager')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamManagerController {
  constructor(
    private readonly examPaperImportService: ExamPaperImportService,
    private readonly examService: ExamService,
  ) {}

  /**
   * Download CSV or Excel Question Paper Template
   * GET /admin/exam-manager/template
   */
  @Get('template')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async downloadTemplate(
    @Query('format') format: ExamImportFormatEnum = ExamImportFormatEnum.XLSX,
    @Res() res: Response,
  ) {
    const { buffer, fileName, contentType } =
      await this.examPaperImportService.generateTemplate(format);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(buffer);
  }

  /**
   * Upload Question Paper CSV/Excel and Transactionally Auto-Create Exam + Sections + Questions
   * POST /admin/exam-manager/import
   */
  @Post('import')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  async uploadQuestionPaper(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { userId: string },
  ) {
    return this.examPaperImportService.processQuestionPaperUpload(
      file,
      user.userId,
    );
  }

  /**
   * Get single import session status & metrics
   * GET /admin/exam-manager/import/:importId
   */
  @Get('import/:importId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getImportSession(@Param('importId') importId: string) {
    return this.examPaperImportService.getImportSession(importId);
  }

  /**
   * Get paginated staging rows for error diagnostics
   * GET /admin/exam-manager/import/:importId/rows
   */
  @Get('import/:importId/rows')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getImportRows(
    @Param('importId') importId: string,
    @Query() query: ExamImportFilterDto,
  ) {
    return this.examPaperImportService.getImportRows(importId, query);
  }

  /**
   * Get list of historical question paper imports
   * GET /admin/exam-manager/import-history
   */
  @Get('import-history')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getImportHistory(@Query() query: ExamImportFilterDto) {
    return this.examPaperImportService.getImportHistory(query);
  }

  /**
   * Download Error Report (.xlsx or .csv) for failed question paper upload
   * GET /admin/exam-manager/import/:importId/errors/export
   */
  @Get('import/:importId/errors/export')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async exportImportErrors(
    @Param('importId') importId: string,
    @Query('format') format: ExamImportFormatEnum = ExamImportFormatEnum.XLSX,
    @Res() res: Response,
  ) {
    const { buffer, fileName, contentType } =
      await this.examPaperImportService.generateErrorReport(importId, format);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(buffer);
  }

  /**
   * Get all exams list
   * GET /admin/exam-manager/exams
   */
  @Get('exams')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getAllExams(@Query() filter: ExamFilterDto) {
    return this.examService.findAll(filter);
  }

  /**
   * Get exam details by ID
   * GET /admin/exam-manager/exams/:id
   */
  @Get('exams/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getExamById(@Param('id') id: string) {
    return this.examService.findOne(id);
  }
}
