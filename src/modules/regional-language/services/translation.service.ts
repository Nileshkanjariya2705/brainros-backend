import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQuestionTranslationDto,
  UpdateQuestionTranslationDto,
  CreateOptionTranslationDto,
  UpsertFullQuestionTranslationDto,
} from '../dto/create-translation.dto';
import { LanguageService } from './language.service';
import { MANDATORY_LANGUAGE_CODES } from '../constants/supported-languages.constant';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly languageService: LanguageService,
  ) {}

  /**
   * Get all translations for a question
   */
  async getQuestionTranslations(questionId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException(`Question with ID '${questionId}' not found`);
    }

    return this.prisma.questionTranslation.findMany({
      where: { questionId },
      include: {
        language: {
          select: { id: true, code: true, name: true, nativeName: true },
        },
      },
    });
  }

  /**
   * Get translation for a specific question & language
   */
  async getQuestionTranslationByLanguage(
    questionId: string,
    languageId: string,
  ) {
    const translation = await this.prisma.questionTranslation.findUnique({
      where: {
        questionId_languageId: { questionId, languageId },
      },
      include: {
        language: {
          select: { id: true, code: true, name: true, nativeName: true },
        },
      },
    });

    if (!translation) {
      throw new NotFoundException(
        `Translation for question '${questionId}' in language '${languageId}' not found`,
      );
    }
    return translation;
  }

  /**
   * Upsert a question translation record
   */
  async upsertQuestionTranslation(
    questionId: string,
    dto: CreateQuestionTranslationDto,
  ) {
    await this.languageService.getLanguageById(dto.languageId);

    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException(`Question with ID '${questionId}' not found`);
    }

    return this.prisma.questionTranslation.upsert({
      where: {
        questionId_languageId: { questionId, languageId: dto.languageId },
      },
      create: {
        questionId,
        languageId: dto.languageId,
        questionText: dto.questionText,
        passageText: dto.passageText || null,
        assertionText: dto.assertionText || null,
        reasonText: dto.reasonText || null,
        explanation: dto.explanation || null,
      },
      update: {
        questionText: dto.questionText,
        passageText:
          dto.passageText !== undefined ? dto.passageText : undefined,
        assertionText:
          dto.assertionText !== undefined ? dto.assertionText : undefined,
        reasonText: dto.reasonText !== undefined ? dto.reasonText : undefined,
        explanation:
          dto.explanation !== undefined ? dto.explanation : undefined,
      },
      include: {
        language: {
          select: { id: true, code: true, name: true, nativeName: true },
        },
      },
    });
  }

  /**
   * Atomically upsert a question translation and all its option translations
   */
  async upsertFullQuestionTranslation(
    questionId: string,
    dto: UpsertFullQuestionTranslationDto,
  ) {
    await this.languageService.getLanguageById(dto.languageId);

    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { options: true },
    });
    if (!question) {
      throw new NotFoundException(`Question with ID '${questionId}' not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Upsert Question Translation
      const questionTranslation = await tx.questionTranslation.upsert({
        where: {
          questionId_languageId: { questionId, languageId: dto.languageId },
        },
        create: {
          questionId,
          languageId: dto.languageId,
          questionText: dto.questionText,
          passageText: dto.passageText || null,
          assertionText: dto.assertionText || null,
          reasonText: dto.reasonText || null,
          explanation: dto.explanation || null,
        },
        update: {
          questionText: dto.questionText,
          passageText:
            dto.passageText !== undefined ? dto.passageText : undefined,
          assertionText:
            dto.assertionText !== undefined ? dto.assertionText : undefined,
          reasonText: dto.reasonText !== undefined ? dto.reasonText : undefined,
          explanation:
            dto.explanation !== undefined ? dto.explanation : undefined,
        },
        include: {
          language: {
            select: { id: true, code: true, name: true, nativeName: true },
          },
        },
      });

      // 2. Upsert Option Translations if provided
      const updatedOptions: any[] = [];
      if (dto.optionTranslations && dto.optionTranslations.length > 0) {
        for (const optTr of dto.optionTranslations) {
          const opt = await tx.questionOptionTranslation.upsert({
            where: {
              optionId_languageId: {
                optionId: optTr.optionId,
                languageId: dto.languageId,
              },
            },
            create: {
              optionId: optTr.optionId,
              languageId: dto.languageId,
              optionText: optTr.optionText,
            },
            update: {
              optionText: optTr.optionText,
            },
          });
          updatedOptions.push(opt);
        }
      }

      return {
        questionTranslation,
        optionTranslations: updatedOptions,
      };
    });
  }

  /**
   * Delete a question translation
   */
  async deleteQuestionTranslation(questionId: string, languageId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { translations: true },
    });
    if (!question) {
      throw new NotFoundException(`Question with ID '${questionId}' not found`);
    }

    if (question.translations.length <= 1) {
      throw new BadRequestException(
        'Cannot delete the only remaining translation for a question.',
      );
    }

    if (question.defaultLanguageId === languageId) {
      throw new BadRequestException(
        'Cannot delete the default language translation for a question.',
      );
    }

    await this.prisma.questionTranslation.delete({
      where: { questionId_languageId: { questionId, languageId } },
    });

    return { message: 'Question translation deleted successfully' };
  }

  /**
   * Upsert single option translation
   */
  async upsertOptionTranslation(
    optionId: string,
    dto: CreateOptionTranslationDto,
  ) {
    await this.languageService.getLanguageById(dto.languageId);

    const option = await this.prisma.questionOption.findUnique({
      where: { id: optionId },
    });
    if (!option) {
      throw new NotFoundException(`Option with ID '${optionId}' not found`);
    }

    return this.prisma.questionOptionTranslation.upsert({
      where: {
        optionId_languageId: { optionId, languageId: dto.languageId },
      },
      create: {
        optionId,
        languageId: dto.languageId,
        optionText: dto.optionText,
      },
      update: {
        optionText: dto.optionText,
      },
    });
  }

  /**
   * Get translation completeness matrix for a question across all supported regional languages
   */
  async getTranslationCompleteness(questionId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        translations: true,
        options: {
          include: { translations: true },
        },
      },
    });
    if (!question) {
      throw new NotFoundException(`Question with ID '${questionId}' not found`);
    }

    const allLanguages = await this.languageService.getAllLanguages(false);

    const matrix = allLanguages.map((lang) => {
      const qTr = question.translations.find((t) => t.languageId === lang.id);
      const isQuestionTranslated = Boolean(qTr?.questionText?.trim());

      const totalOptions = question.options.length;
      const translatedOptionsCount = question.options.filter((opt) =>
        opt.translations.some(
          (ot) => ot.languageId === lang.id && ot.optionText?.trim(),
        ),
      ).length;

      const isComplete =
        isQuestionTranslated &&
        (totalOptions === 0 || translatedOptionsCount === totalOptions);

      return {
        languageId: lang.id,
        languageCode: lang.code,
        languageName: lang.name,
        nativeName: lang.nativeName,
        isQuestionTranslated,
        translatedOptionsCount,
        totalOptions,
        isComplete,
        isDefaultLanguage: question.defaultLanguageId === lang.id,
      };
    });

    return {
      questionId,
      defaultLanguageId: question.defaultLanguageId,
      completeness: matrix,
      isFullyTranslatedAllLanguages: matrix.every((m) => m.isComplete),
    };
  }

  /**
   * Validate that all 9 mandatory regional languages are translated for a question
   */
  async validateQuestionMandatoryTranslations(
    questionId: string,
  ): Promise<{ isValid: boolean; missingLanguages: string[] }> {
    const completeness = await this.getTranslationCompleteness(questionId);
    const missing = completeness.completeness
      .filter(
        (c) =>
          MANDATORY_LANGUAGE_CODES.includes(c.languageCode as any) &&
          !c.isComplete,
      )
      .map((c) => c.languageName);

    return {
      isValid: missing.length === 0,
      missingLanguages: missing,
    };
  }
}
