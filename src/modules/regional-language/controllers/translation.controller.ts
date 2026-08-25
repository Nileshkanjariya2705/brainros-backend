import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TranslationService } from '../services/translation.service';
import {
  CreateQuestionTranslationDto,
  CreateOptionTranslationDto,
  UpsertFullQuestionTranslationDto,
} from '../dto/create-translation.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('translations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

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
    return this.translationService.upsertFullQuestionTranslation(questionId, dto);
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
    return this.translationService.deleteQuestionTranslation(questionId, languageId);
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
