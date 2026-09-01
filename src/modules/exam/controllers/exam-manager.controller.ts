import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Res,
  BadRequestException,
} from '@nestjs/common';
import {
  FileInterceptor,
  AnyFilesInterceptor,
} from '@nestjs/platform-express';
import type { Response } from 'express';
import { ExamPaperImportService } from '../services/exam-paper-import.service';
import { ExamService } from '../exam.service';
import {
  ExamImportFormatEnum,
  ExamImportFilterDto,
  CreateExamFromUploadDto,
  ExamManagerFilterDto,
} from '../dto/exam-manager.dto';
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
   * 1. Get all active predefined & custom blueprints from master data
   * GET /admin/exam-manager/blueprints
   */
  @Get('blueprints')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getBlueprints() {
    const data = await this.examPaperImportService.getActiveBlueprints();
    return {
      statusCode: 200,
      message: 'Active exam blueprints retrieved successfully',
      data,
    };
  }

  /**
   * 2. Validate Question Paper + Multiple Simultaneous Regional Translation Files against Blueprint
   * POST /admin/exam-manager/validate
   */
  @Post('validate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseInterceptors(AnyFilesInterceptor())
  async validateUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { blueprintId: string; languageIds?: string | string[] },
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded for validation.');
    }

    const questionFile = files.find(
      (f) =>
        f.fieldname === 'questionFile' ||
        f.fieldname === 'file' ||
        !f.fieldname.startsWith('translation_'),
    );

    if (!questionFile) {
      throw new BadRequestException('Question paper file is required.');
    }

    // Extract translation files
    const translationFiles: Array<{
      file: Express.Multer.File;
      languageId: string;
    }> = [];

    for (const f of files) {
      if (f.fieldname.startsWith('translation_')) {
        const langId = f.fieldname.replace('translation_', '');
        translationFiles.push({ file: f, languageId: langId });
      }
    }

    const data =
      await this.examPaperImportService.validateQuestionPaperAndTranslations(
        questionFile,
        body.blueprintId,
        translationFiles,
      );

    return {
      statusCode: 200,
      message: data.isValid
        ? 'Question paper and translations validated successfully.'
        : 'Validation completed with errors.',
      data,
    };
  }

  /**
   * 3. Transactionally Create Draft Exam + Sections + Questions + Immutable Version + Translations
   * POST /admin/exam-manager/create-from-upload
   */
  @Post('create-from-upload')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseInterceptors(AnyFilesInterceptor())
  async createExamFromUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateExamFromUploadDto,
    @CurrentUser() user: { userId: string },
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded for exam creation.');
    }

    const questionFile = files.find(
      (f) =>
        f.fieldname === 'questionFile' ||
        f.fieldname === 'file' ||
        !f.fieldname.startsWith('translation_'),
    );

    if (!questionFile) {
      throw new BadRequestException('Question paper file is required.');
    }

    const translationFiles: Array<{
      file: Express.Multer.File;
      languageId: string;
    }> = [];

    for (const f of files) {
      if (f.fieldname.startsWith('translation_')) {
        const langId = f.fieldname.replace('translation_', '');
        translationFiles.push({ file: f, languageId: langId });
      }
    }

    const data =
      await this.examPaperImportService.createExamFromValidatedUpload(
        body,
        questionFile,
        translationFiles,
        user.userId,
      );

    return {
      statusCode: 201,
      message: 'Exam created successfully in DRAFT status.',
      data,
    };
  }

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
   * Get all exams list with search, status, type filter & pagination
   * GET /admin/exam-manager/exams
   */
  @Get('exams')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAllExams(@Query() filter: ExamManagerFilterDto) {
    return this.examPaperImportService.getAllExamsList(filter);
  }

  /**
   * Get exam details by ID
   * GET /admin/exam-manager/exams/:id
   */
  @Get('exams/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getExamById(@Param('id') id: string) {
    return this.examService.findExamById(id);
  }
}

