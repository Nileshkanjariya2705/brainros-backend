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
  Res,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ExamTranslationService } from '../services/exam-translation.service';
import {
  ExamTranslationQueryDto,
  ImportExamTranslationDto,
  ExamTranslationExportFormat,
} from '../dto/exam-translation.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FeatureGuard } from '../../feature-flag/feature-flag.guard';
import { RequireFeature } from '../../feature-flag/feature-flag.decorator';
import { FEATURE_KEYS } from '../../feature-flag/feature-flag.constants';

@Controller('exams/:examId/translations')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
export class ExamTranslationController {
  constructor(
    private readonly examTranslationService: ExamTranslationService,
  ) {}

  /**
   * 1. Get Translation Coverage Breakdown for an Exam across all configured languages
   * GET /exams/:examId/translations/coverage
   */
  @Get('coverage')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getExamTranslationCoverage(@Param('examId') examId: string) {
    const data =
      await this.examTranslationService.getExamTranslationCoverage(examId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Exam translation coverage retrieved successfully',
      data,
    };
  }

  /**
   * 2. Download Pre-filled Translation Template for this specific Exam & Language
   * GET /exams/:examId/translations/template?languageId=...&format=xlsx
   */
  @Get('template')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  async downloadExamTranslationTemplate(
    @Param('examId') examId: string,
    @Query() query: ExamTranslationQueryDto,
    @Res() res: Response,
  ) {
    if (!query.languageId) {
      throw new BadRequestException('Query parameter "languageId" is required.');
    }

    const { buffer, fileName, contentType } =
      await this.examTranslationService.generateExamTranslationTemplate(
        examId,
        query.languageId,
        query.format || ExamTranslationExportFormat.XLSX,
      );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  /**
   * 3. Export Existing Exam Translations for a language
   * GET /exams/:examId/translations/export?languageId=...&format=xlsx
   */
  @Get('export')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  async exportExamTranslations(
    @Param('examId') examId: string,
    @Query() query: ExamTranslationQueryDto,
    @Res() res: Response,
  ) {
    if (!query.languageId) {
      throw new BadRequestException('Query parameter "languageId" is required.');
    }

    const { buffer, fileName, contentType } =
      await this.examTranslationService.generateExamTranslationTemplate(
        examId,
        query.languageId,
        query.format || ExamTranslationExportFormat.XLSX,
      );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  /**
   * 4. Validate Uploaded Translation File against target Exam questions (Diff Preview)
   * POST /exams/:examId/translations/validate
   */
  @Post('validate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  @UseInterceptors(FileInterceptor('file'))
  async validateExamTranslation(
    @Param('examId') examId: string,
    @Body('languageId') languageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!languageId) {
      throw new BadRequestException('Body parameter "languageId" is required.');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const data =
      await this.examTranslationService.validateExamTranslationFile(
        examId,
        languageId,
        file,
      );

    return {
      statusCode: HttpStatus.OK,
      message: 'Translation file validated successfully',
      data,
    };
  }

  /**
   * 5. Execute Transactional Translation Import for target Exam
   * POST /exams/:examId/translations/import
   */
  @Post('import')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequireFeature(FEATURE_KEYS.BULK_IMPORT_TRANSLATION)
  @UseInterceptors(FileInterceptor('file'))
  async importExamTranslations(
    @Param('examId') examId: string,
    @Body() dto: ImportExamTranslationDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { userId: string },
  ) {
    if (!dto.languageId) {
      throw new BadRequestException('Body parameter "languageId" is required.');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const replaceMode = String(dto.replaceMode) === 'true' || dto.replaceMode === true;

    const data = await this.examTranslationService.importExamTranslations(
      examId,
      dto.languageId,
      file,
      user.userId,
      replaceMode,
    );

    return {
      statusCode: HttpStatus.OK,
      message: data.message,
      data,
    };
  }
}
