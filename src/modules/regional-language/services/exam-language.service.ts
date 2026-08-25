import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SetExamLanguagesDto } from '../dto/exam-language.dto';
import { LanguageService } from './language.service';

@Injectable()
export class ExamLanguageService {
  private readonly logger = new Logger(ExamLanguageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly languageService: LanguageService,
  ) {}

  /**
   * Get configured languages for an exam
   */
  async getExamLanguages(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        languages: {
          orderBy: { displayOrder: 'asc' },
          include: {
            language: {
              select: {
                id: true,
                code: true,
                name: true,
                nativeName: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    // If no specific languages are configured yet, return active system languages
    if (!exam.languages || exam.languages.length === 0) {
      const allActive = await this.languageService.getAllLanguages(false);
      return allActive.map((l, idx) => ({
        id: l.id,
        examId,
        languageId: l.id,
        isDefault: idx === 0, // English as default
        displayOrder: idx,
        language: l,
      }));
    }

    return exam.languages;
  }

  /**
   * Configure allowed languages for an exam (Admin/SuperAdmin)
   */
  async setExamLanguages(examId: string, dto: SetExamLanguagesDto) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
    });
    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    if (!dto.languages || dto.languages.length === 0) {
      throw new BadRequestException('At least one language must be enabled for an exam.');
    }

    // Ensure at least one language is marked as default
    const hasDefault = dto.languages.some((l) => l.isDefault);
    if (!hasDefault) {
      dto.languages[0].isDefault = true;
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete previous configurations
      await tx.examLanguage.deleteMany({ where: { examId } });

      // 2. Insert new configuration records
      const created: any[] = [];
      for (let i = 0; i < dto.languages.length; i++) {

        const item = dto.languages[i];
        const record = await tx.examLanguage.create({
          data: {
            examId,
            languageId: item.languageId,
            isDefault: item.isDefault ?? (i === 0),
            displayOrder: item.displayOrder ?? i,
          },
          include: {
            language: {
              select: {
                id: true,
                code: true,
                name: true,
                nativeName: true,
              },
            },
          },
        });
        created.push(record);
      }

      return created;
    });
  }

  /**
   * Verify if a language is enabled and allowed for an exam
   */
  async validateExamLanguageAllowed(examId: string, languageId: string): Promise<boolean> {
    const examLanguage = await this.prisma.examLanguage.findFirst({
      where: { examId, languageId },
      include: { language: true },
    });

    if (examLanguage) {
      return examLanguage.language.isActive;
    }

    // If no explicit exam languages were saved yet, check if language is generally active in the system
    const activeLang = await this.prisma.preferredLanguage.findUnique({
      where: { id: languageId },
    });
    return Boolean(activeLang?.isActive);
  }
}
