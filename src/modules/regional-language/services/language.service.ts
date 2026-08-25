import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLanguageDto, UpdateLanguageDto } from '../dto/language.dto';
import { SUPPORTED_NINE_REGIONAL_LANGUAGES } from '../constants/supported-languages.constant';

@Injectable()
export class LanguageService implements OnModuleInit {
  private readonly logger = new Logger(LanguageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Automatically seed and synchronize 9 Regional Languages on application startup
   */
  async onModuleInit() {
    await this.seedNineRegionalLanguages();
  }

  async seedNineRegionalLanguages() {
    for (const lang of SUPPORTED_NINE_REGIONAL_LANGUAGES) {
      const existing = await this.prisma.preferredLanguage.findFirst({
        where: {
          OR: [{ code: lang.code }, { name: lang.name }],
        },
      });

      if (!existing) {
        await this.prisma.preferredLanguage.create({
          data: {
            code: lang.code,
            name: lang.name,
            nativeName: lang.nativeName,
            description: lang.description,
            displayOrder: lang.displayOrder,
            isActive: true,
          },
        });
        this.logger.log(`Seeded regional language: ${lang.name} (${lang.code})`);
      } else if (!existing.code || !existing.nativeName) {
        await this.prisma.preferredLanguage.update({
          where: { id: existing.id },
          data: {
            code: lang.code,
            nativeName: lang.nativeName,
            description: existing.description || lang.description,
            displayOrder: existing.displayOrder || lang.displayOrder,
          },
        });
        this.logger.log(`Updated regional language metadata: ${lang.name} (${lang.code})`);
      }
    }
  }

  /**
   * Get all languages (public / admin)
   */
  async getAllLanguages(includeInactive = false) {
    return this.prisma.preferredLanguage.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Get single language by ID
   */
  async getLanguageById(id: string) {
    const language = await this.prisma.preferredLanguage.findUnique({
      where: { id },
    });
    if (!language) {
      throw new NotFoundException(`Language with ID '${id}' not found`);
    }
    return language;
  }

  /**
   * Get single language by code (e.g. 'hi', 'en', 'gu')
   */
  async getLanguageByCode(code: string) {
    const language = await this.prisma.preferredLanguage.findUnique({
      where: { code: code.toLowerCase() },
    });
    if (!language) {
      throw new NotFoundException(`Language with code '${code}' not found`);
    }
    return language;
  }

  /**
   * Create a new language (Admin/SuperAdmin)
   */
  async createLanguage(dto: CreateLanguageDto) {
    const code = dto.code.toLowerCase().trim();
    const existingCode = await this.prisma.preferredLanguage.findUnique({
      where: { code },
    });
    if (existingCode) {
      throw new BadRequestException(`Language code '${code}' already exists.`);
    }

    const existingName = await this.prisma.preferredLanguage.findUnique({
      where: { name: dto.name.trim() },
    });
    if (existingName) {
      throw new BadRequestException(`Language name '${dto.name}' already exists.`);
    }

    return this.prisma.preferredLanguage.create({
      data: {
        code,
        name: dto.name.trim(),
        nativeName: dto.nativeName?.trim() || dto.name.trim(),
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
        displayOrder: dto.displayOrder ?? 0,
      },
    });
  }

  /**
   * Update language properties (Admin/SuperAdmin)
   */
  async updateLanguage(id: string, dto: UpdateLanguageDto) {
    await this.getLanguageById(id);

    return this.prisma.preferredLanguage.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        nativeName: dto.nativeName !== undefined ? dto.nativeName.trim() : undefined,
        description: dto.description !== undefined ? dto.description.trim() : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        displayOrder: dto.displayOrder !== undefined ? dto.displayOrder : undefined,
      },
    });
  }

  /**
   * Delete language (only if no attempts or questions are linked)
   */
  async deleteLanguage(id: string) {
    await this.getLanguageById(id);

    const usageCount = await this.prisma.questionTranslation.count({
      where: { languageId: id },
    });

    if (usageCount > 0) {
      throw new BadRequestException(
        'Cannot delete language that is currently linked to question translations. Deactivate it instead.',
      );
    }

    await this.prisma.preferredLanguage.delete({ where: { id } });
    return { message: 'Language deleted successfully' };
  }
}
