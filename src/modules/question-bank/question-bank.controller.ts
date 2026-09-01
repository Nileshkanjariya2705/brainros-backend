import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  Res,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QuestionBankService } from './question-bank.service';
import { QuestionImportService } from './services/question-import.service';
import {
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionFilterDto,
  SubmitQuestionDto,
  RejectQuestionDto,
  ArchiveQuestionDto,
} from './dto/question.dto';
import {
  QuestionImportFilterDto,
  UpdateImportRowDto,
  ImportFormatEnum,
} from './dto/question-import.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeatureGuard } from '../feature-flag/feature-flag.guard';
import { RequireFeature } from '../feature-flag/feature-flag.decorator';
import { FEATURE_KEYS } from '../feature-flag/feature-flag.constants';

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
export class QuestionBankController {
  private readonly logger = new Logger(QuestionBankController.name);

  constructor(
    private readonly questionBankService: QuestionBankService,
    private readonly questionImportService: QuestionImportService,
    @InjectQueue('question-import')
    private readonly importQueue: Queue,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  // BULK IMPORT APIS (FEATURE: BULK_IMPORT_QUESTION)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Download sample question import template (.xlsx or .csv)
   * GET /questions/import/template
   */
  @Get('import/template')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  async downloadTemplate(
    @Query('format') format: ImportFormatEnum = ImportFormatEnum.XLSX,
    @Res() res: Response,
  ) {
    const { buffer, fileName, contentType } =
      await this.questionImportService.generateTemplate(format);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(buffer);
  }

  /**
   * Upload CSV or Excel file to initiate bulk question import session
   * POST /questions/import
   */
  @Post('import')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImportFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    const userId = user?.userId || user?.id || user?.sub;
    const session = await this.questionImportService.createImportSession(
      file,
      userId,
    );

    // Parse & validate spreadsheet immediately
    const validatedSession =
      await this.questionImportService.parseAndValidateImport(session.id);

    return validatedSession;
  }

  /**
   * Get single import session status & counters
   * GET /questions/import/:importId
   */
  @Get('import/:importId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  getImportSession(@Param('importId') importId: string) {
    return this.questionImportService.getImportSession(importId);
  }

  /**
   * Get paginated staging rows for preview & error inspection
   * GET /questions/import/:importId/rows
   */
  @Get('import/:importId/rows')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  getImportRows(
    @Param('importId') importId: string,
    @Query() query: QuestionImportFilterDto,
  ) {
    return this.questionImportService.getImportRows(importId, query);
  }

  /**
   * Update an imported staging row before confirmation
   * PATCH /questions/import/:importId/rows/:rowId
   */
  @Patch('import/:importId/rows/:rowId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  updateImportRow(
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
    @Body() dto: UpdateImportRowDto,
  ) {
    return this.questionImportService.updateImportRow(importId, rowId, dto);
  }

  /**
   * Confirm and execute batch question import
   * POST /questions/import/:importId/confirm
   */
  @Post('import/:importId/confirm')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  @HttpCode(HttpStatus.OK)
  async confirmImport(
    @Param('importId') importId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.questionImportService.executeImport(
      importId,
      user.userId,
    );

    return result;
  }

  /**
   * Cancel an import session
   * POST /questions/import/:importId/cancel
   */
  @Post('import/:importId/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  @HttpCode(HttpStatus.OK)
  cancelImport(@Param('importId') importId: string) {
    return this.questionImportService.cancelImportSession(importId);
  }

  /**
   * Download Error Report (.xlsx or .csv) for an import session
   * GET /questions/import/:importId/errors/export
   */
  @Get('import/:importId/errors/export')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_QUESTION)
  async exportImportErrors(
    @Param('importId') importId: string,
    @Query('format') format: ImportFormatEnum = ImportFormatEnum.XLSX,
    @Res() res: Response,
  ) {
    const { buffer, fileName, contentType } =
      await this.questionImportService.generateErrorReport(importId, format);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(buffer);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STANDARD QUESTION BANK CRUD APIS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new question (DRAFT) (FEATURE: ADD_QUESTION)
   * POST /questions
   */
  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.ADD_QUESTION)
  @HttpCode(HttpStatus.CREATED)
  createQuestion(
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: { userId: string; roles: string[] },
  ) {
    return this.questionBankService.createQuestion(dto, user.userId);
  }

  /**
   * List questions with filtering, search, and pagination (FEATURE: QUESTION_BANK)
   * GET /questions
   */
  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  findQuestions(@Query() filter: QuestionFilterDto) {
    return this.questionBankService.findQuestions(filter);
  }

  /**
   * Overall Question Bank Stats (FEATURE: QUESTION_BANK)
   * GET /questions/stats
   */
  @Get('stats')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  getOverallQuestionStats(@Query('examTargetId') examTargetId?: string) {
    return this.questionBankService.getQuestionStats(examTargetId);
  }

  /**
   * Get Question Bank stats for specific exam target (FEATURE: QUESTION_BANK)
   * GET /questions/stats/:examTargetId
   */
  @Get('stats/:examTargetId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  getQuestionStatsByExam(@Param('examTargetId') examTargetId: string) {
    return this.questionBankService.getQuestionStats(examTargetId);
  }

  /**
   * Get single question by ID with full details (FEATURE: QUESTION_BANK)
   * GET /questions/:id
   */
  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  findQuestionById(@Param('id') id: string) {
    return this.questionBankService.findQuestionById(id);
  }

  /**
   * Get review and audit history for a question (FEATURE: QUESTION_BANK)
   * GET /questions/:id/history
   */
  @Get(':id/history')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  getQuestionHistory(@Param('id') id: string) {
    return this.questionBankService.getQuestionHistory(id);
  }

  /**
   * Get version history lineage of a question (FEATURE: QUESTION_BANK)
   * GET /questions/:id/versions
   */
  @Get(':id/versions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  getQuestionVersions(@Param('id') id: string) {
    return this.questionBankService.getQuestionVersions(id);
  }

  /**
   * Update question (FEATURE: QUESTION_BANK)
   * PATCH /questions/:id
   */
  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  updateQuestion(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: { userId: string; roles: string[] },
  ) {
    return this.questionBankService.updateQuestion(
      id,
      dto,
      user.userId,
      user.roles,
    );
  }

  /**
   * Submit a question for Super Admin review (FEATURE: QUESTION_BANK)
   * POST /questions/:id/submit
   */
  @Post(':id/submit')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  @HttpCode(HttpStatus.OK)
  submitQuestion(
    @Param('id') id: string,
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.submitQuestion(
      id,
      user.userId,
      dto?.comment,
    );
  }

  /**
   * Super Admin starts review on a submitted question (FEATURE: QUESTION_BANK)
   * POST /questions/:id/start-review
   */
  @Post(':id/start-review')
  @Roles('SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  @HttpCode(HttpStatus.OK)
  startReview(
    @Param('id') id: string,
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.startReview(id, user.userId, dto?.comment);
  }

  /**
   * Super Admin approves question (FEATURE: QUESTION_BANK)
   * POST /questions/:id/approve
   */
  @Post(':id/approve')
  @Roles('SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  @HttpCode(HttpStatus.OK)
  approveQuestion(
    @Param('id') id: string,
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: { userId: string; roles: string[] },
  ) {
    return this.questionBankService.approveQuestion(
      id,
      user.userId,
      user.roles,
      dto?.comment,
    );
  }

  /**
   * Super Admin rejects question with a reason (FEATURE: QUESTION_BANK)
   * POST /questions/:id/reject
   */
  @Post(':id/reject')
  @Roles('SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  @HttpCode(HttpStatus.OK)
  rejectQuestion(
    @Param('id') id: string,
    @Body() dto: RejectQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.rejectQuestion(id, user.userId, dto.reason);
  }

  /**
   * Super Admin archives question (FEATURE: QUESTION_BANK)
   * POST /questions/:id/archive
   */
  @Post(':id/archive')
  @Roles('SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  @HttpCode(HttpStatus.OK)
  archiveQuestion(
    @Param('id') id: string,
    @Body() dto: ArchiveQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.archiveQuestion(
      id,
      user.userId,
      dto?.reason,
    );
  }

  /**
   * Delete or archive question (FEATURE: QUESTION_BANK)
   * DELETE /questions/:id
   */
  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.QUESTION_BANK)
  deleteQuestion(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.deleteQuestion(id, user.userId);
  }
}
