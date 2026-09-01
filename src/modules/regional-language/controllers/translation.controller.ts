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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TranslationService } from '../services/translation.service';
import { TranslationImportService } from '../services/translation-import.service';
import {
  CreateQuestionTranslationDto,
  CreateOptionTranslationDto,
  UpsertFullQuestionTranslationDto,
} from '../dto/create-translation.dto';
import {
  TranslationImportFilterDto,
  UpdateTranslationImportRowDto,
  TranslationImportFormatEnum,
} from '../dto/translation-import.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FeatureGuard } from '../../feature-flag/feature-flag.guard';
import { RequireFeature } from '../../feature-flag/feature-flag.decorator';
import { FEATURE_KEYS } from '../../feature-flag/feature-flag.constants';

@Controller('translations')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
export class TranslationController {
  constructor(
    private readonly translationService: TranslationService,
    private readonly translationImportService: TranslationImportService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════
  // BULK QUESTION TRANSLATION IMPORT ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Download CSV or Excel Translation Import Template
   * GET /translations/import/template
   */
  @Get('import/template')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  async downloadTemplate(
    @Query('format') format: TranslationImportFormatEnum = TranslationImportFormatEnum.XLSX,
    @Res() res: Response,
  ) {
    const { buffer, fileName, contentType } =
      await this.translationImportService.generateTemplate(format);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(buffer);
  }

  /**
   * Upload CSV or Excel file to initiate translation import session
   * POST /translations/import
   */
  @Post('import')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImportFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { userId: string },
  ) {
    const session = await this.translationImportService.createImportSession(
      file,
      user.userId,
    );

    const validatedSession =
      await this.translationImportService.parseAndValidateImport(session.id);

    return validatedSession;
  }

  /**
   * Get single translation import session status & counters
   * GET /translations/import/:importId
   */
  @Get('import/:importId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  getImportSession(@Param('importId') importId: string) {
    return this.translationImportService.getImportSession(importId);
  }

  /**
   * Get paginated staging rows for preview & error inspection
   * GET /translations/import/:importId/rows
   */
  @Get('import/:importId/rows')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  getImportRows(
    @Param('importId') importId: string,
    @Query() query: TranslationImportFilterDto,
  ) {
    return this.translationImportService.getImportRows(importId, query);
  }

  /**
   * Update an imported staging translation row before confirmation
   * PATCH /translations/import/:importId/rows/:rowId
   */
  @Patch('import/:importId/rows/:rowId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  updateImportRow(
    @Param('importId') importId: string,
    @Param('rowId') rowId: string,
    @Body() dto: UpdateTranslationImportRowDto,
  ) {
    return this.translationImportService.updateImportRow(importId, rowId, dto);
  }

  /**
   * Confirm and execute batch translation import
   * POST /translations/import/:importId/confirm
   */
  @Post('import/:importId/confirm')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  @HttpCode(HttpStatus.OK)
  async confirmImport(
    @Param('importId') importId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.translationImportService.executeImport(
      importId,
      user.userId,
    );

    return result;
  }

  /**
   * Cancel a translation import session
   * POST /translations/import/:importId/cancel
   */
  @Post('import/:importId/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  @HttpCode(HttpStatus.OK)
  cancelImport(@Param('importId') importId: string) {
    return this.translationImportService.cancelImportSession(importId);
  }

  /**
   * Download Error Report (.xlsx or .csv) for a translation import session
   * GET /translations/import/:importId/errors/export
   */
  @Get('import/:importId/errors/export')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  async exportImportErrors(
    @Param('importId') importId: string,
    @Query('format') format: TranslationImportFormatEnum = TranslationImportFormatEnum.XLSX,
    @Res() res: Response,
  ) {
    const { buffer, fileName, contentType } =
      await this.translationImportService.generateErrorReport(importId, format);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(buffer);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STANDARD QUESTION TRANSLATION CRUD ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get translation completeness matrix for a question across all 9 regional languages
   * GET /translations/completeness/:questionId
   */
  @Get('completeness/:questionId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getCompleteness(@Param('questionId') questionId: string) {
    return this.translationService.getTranslationCompleteness(questionId);
  }

  /**
   * Get all translations for a question
   * GET /translations/question/:questionId
   */
  @Get('question/:questionId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getQuestionTranslations(@Param('questionId') questionId: string) {
    return this.translationService.getQuestionTranslations(questionId);
  }

  /**
   * Upsert translation for a question
   * POST /translations/question/:questionId
   */
  @Post('question/:questionId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  upsertQuestionTranslation(
    @Param('questionId') questionId: string,
    @Body() dto: CreateQuestionTranslationDto,
  ) {
    return this.translationService.upsertQuestionTranslation(questionId, dto);
  }

  /**
   * Atomically upsert a question translation along with all its option translations
   * POST /translations/question/:questionId/full
   */
  @Post('question/:questionId/full')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  upsertFullQuestionTranslation(
    @Param('questionId') questionId: string,
    @Body() dto: UpsertFullQuestionTranslationDto,
  ) {
    return this.translationService.upsertFullQuestionTranslation(
      questionId,
      dto,
    );
  }

  /**
   * Delete a question translation
   * DELETE /translations/question/:questionId/:languageId
   */
  @Delete('question/:questionId/:languageId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteQuestionTranslation(
    @Param('questionId') questionId: string,
    @Param('languageId') languageId: string,
  ) {
    return this.translationService.deleteQuestionTranslation(
      questionId,
      languageId,
    );
  }

  /**
   * Upsert translation for an option
   * POST /translations/option/:optionId
   */
  @Post('option/:optionId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  upsertOptionTranslation(
    @Param('optionId') optionId: string,
    @Body() dto: CreateOptionTranslationDto,
  ) {
    return this.translationService.upsertOptionTranslation(optionId, dto);
  }
}
