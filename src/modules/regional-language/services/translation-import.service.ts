import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TranslationImportFilterDto,
  UpdateTranslationImportRowDto,
  TranslationImportFormatEnum,
} from '../dto/translation-import.dto';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export interface NormalizedTranslationRowData {
  question_id: string;
  language_code: string;
  question_text: string;
  passage_text?: string;
  assertion_text?: string;
  reason_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  option_e?: string;
  option_f?: string;
  explanation?: string;
}

@Injectable()
export class TranslationImportService {
  private readonly logger = new Logger(TranslationImportService.name);
  private readonly storageDir: string;

  constructor(private readonly prisma: PrismaService) {
    this.storageDir = path.join(process.cwd(), 'uploads', 'translation-imports');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Validate uploaded file format and size
   */
  validateFile(file: { originalname: string; size: number; buffer: Buffer }): void {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Invalid file type '${ext}'. Only CSV (.csv) and Excel (.xlsx, .xls) files are supported.`,
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
      );
    }
  }

  /**
   * Generate downloadable sample translation template
   */
  async generateTemplate(
    format: TranslationImportFormatEnum = TranslationImportFormatEnum.XLSX,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    // Fetch a few real questions from DB for realistic sample
    const sampleQuestions = await this.prisma.question.findMany({
      take: 4,
      include: {
        options: { orderBy: { displayOrder: 'asc' } },
        translations: { take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activeLanguages = await this.prisma.preferredLanguage.findMany({
      where: { isActive: true },
      select: { code: true, name: true, nativeName: true },
    });

    const headers = [
      'question_id',
      'language_code',
      'question_text',
      'passage_text',
      'assertion_text',
      'reason_text',
      'option_a',
      'option_b',
      'option_c',
      'option_d',
      'option_e',
      'option_f',
      'explanation',
    ];

    const sampleRows: any[] = [];

    if (sampleQuestions.length > 0) {
      const q1 = sampleQuestions[0];
      const optA = q1.options.find((o) => o.optionKey === 'A')?.optionText || 'Option A';
      const optB = q1.options.find((o) => o.optionKey === 'B')?.optionText || 'Option B';
      const optC = q1.options.find((o) => o.optionKey === 'C')?.optionText || 'Option C';
      const optD = q1.options.find((o) => o.optionKey === 'D')?.optionText || 'Option D';

      sampleRows.push({
        question_id: q1.id,
        language_code: 'hi',
        question_text: 'निम्नलिखित में से कौन सा कथन सही है?',
        passage_text: '',
        assertion_text: '',
        reason_text: '',
        option_a: `[अनुवाद] ${optA}`,
        option_b: `[अनुवाद] ${optB}`,
        option_c: `[अनुवाद] ${optC}`,
        option_d: `[अनुवाद] ${optD}`,
        option_e: '',
        option_f: '',
        explanation: 'व्याख्या: चरण दर चरण वैज्ञानिक समाधान।',
      });

      if (sampleQuestions.length > 1) {
        const q2 = sampleQuestions[1];
        sampleRows.push({
          question_id: q2.id,
          language_code: 'gu',
          question_text: 'નીચેનામાંથી કયું વિધાન સાચું છે?',
          passage_text: '',
          assertion_text: '',
          reason_text: '',
          option_a: `[અનુવાદ] વિકલ્પ A`,
          option_b: `[અનુવાદ] વિકલ્પ B`,
          option_c: `[અનુવાદ] વિકલ્પ C`,
          option_d: `[અનુવાદ] વિકલ્પ D`,
          option_e: '',
          option_f: '',
          explanation: 'સમજૂતી: સ્ટેપ બાય સ્ટેપ ઉકેલ.',
        });
      }

      if (sampleQuestions.length > 2) {
        const q3 = sampleQuestions[2];
        sampleRows.push({
          question_id: q3.id,
          language_code: 'mr',
          question_text: 'खालीलपैकी कोणते विधान योग्य आहे?',
          passage_text: '',
          assertion_text: '',
          reason_text: '',
          option_a: `[भाषांतर] पर्याय A`,
          option_b: `[भाषांतर] पर्याय B`,
          option_c: `[भाषांतर] पर्याय C`,
          option_d: `[भाषांतर] पर्याय D`,
          option_e: '',
          option_f: '',
          explanation: 'स्पष्टीकरण: तपशीलवार पायरीनुसार उत्तर.',
        });
      }
    } else {
      sampleRows.push({
        question_id: '00000000-0000-0000-0000-000000000001',
        language_code: 'hi',
        question_text: 'निम्नलिखित में से कौन सा कथन सही है?',
        passage_text: '',
        assertion_text: '',
        reason_text: '',
        option_a: 'विकल्प A',
        option_b: 'विकल्प B',
        option_c: 'विकल्प C',
        option_d: 'विकल्प D',
        option_e: '',
        option_f: '',
        explanation: 'चरणबद्ध व्याख्या',
      });
    }

    if (format === TranslationImportFormatEnum.CSV) {
      const csvLines = [headers.join(',')];
      for (const row of sampleRows) {
        const line = headers
          .map((h) => {
            const val = row[h] ?? '';
            return `"${String(val).replace(/"/g, '""')}"`;
          })
          .join(',');
        csvLines.push(line);
      }
      return {
        buffer: Buffer.from(csvLines.join('\n'), 'utf-8'),
        fileName: 'question_translation_template.csv',
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Exam Management Platform';
    const worksheet = workbook.addWorksheet('Translations');

    worksheet.columns = [
      { header: 'question_id', key: 'question_id', width: 40 },
      { header: 'language_code', key: 'language_code', width: 16 },
      { header: 'question_text', key: 'question_text', width: 50 },
      { header: 'passage_text', key: 'passage_text', width: 35 },
      { header: 'assertion_text', key: 'assertion_text', width: 35 },
      { header: 'reason_text', key: 'reason_text', width: 35 },
      { header: 'option_a', key: 'option_a', width: 30 },
      { header: 'option_b', key: 'option_b', width: 30 },
      { header: 'option_c', key: 'option_c', width: 30 },
      { header: 'option_d', key: 'option_d', width: 30 },
      { header: 'option_e', key: 'option_e', width: 25 },
      { header: 'option_f', key: 'option_f', width: 25 },
      { header: 'explanation', key: 'explanation', width: 45 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4338CA' }, // Indigo
    };

    for (const row of sampleRows) {
      worksheet.addRow(row);
    }

    // Add Instructions sheet
    const guideSheet = workbook.addWorksheet('Language Codes & Guide');
    guideSheet.columns = [
      { header: 'Language Code', key: 'code', width: 18 },
      { header: 'Language Name', key: 'name', width: 25 },
      { header: 'Native Script', key: 'nativeName', width: 25 },
    ];
    const guideHeader = guideSheet.getRow(1);
    guideHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    guideHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };

    for (const lang of activeLanguages) {
      guideSheet.addRow(lang);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: 'question_translation_template.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * Create translation import session record and save file to disk
   */
  async createImportSession(
    file: { originalname: string; size: number; buffer: Buffer },
    userId: string,
  ) {
    this.validateFile(file);

    const ext = path.extname(file.originalname).toLowerCase();
    const storedFileName = `${Date.now()}_${path.basename(file.originalname)}`;
    const storagePath = path.join(this.storageDir, storedFileName);

    await fs.promises.writeFile(storagePath, file.buffer);

    const importSession = await (this.prisma as any).translationImport.create({
      data: {
        fileName: file.originalname,
        fileType: ext.replace('.', '').toUpperCase(),
        storageKey: storagePath,
        fileSize: file.size,
        status: 'UPLOADED',
        createdById: userId,
      },
    });

    return importSession;
  }

  /**
   * Parse uploaded file and stage normalized translation rows
   */
  async parseAndValidateImport(importId: string): Promise<any> {
    const importRecord = await (this.prisma as any).translationImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException(`Translation import session '${importId}' not found.`);
    }

    // Set status to PROCESSING
    await (this.prisma as any).translationImport.update({
      where: { id: importId },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
      },
    });

    try {
      if (!importRecord.storageKey || !fs.existsSync(importRecord.storageKey)) {
        throw new BadRequestException('Import file not found on server.');
      }

      const fileBuffer = await fs.promises.readFile(importRecord.storageKey);
      const rawRows = await this.parseFileToRows(fileBuffer, importRecord.fileName);

      if (rawRows.length === 0) {
        await (this.prisma as any).translationImport.update({
          where: { id: importId },
          data: {
            status: 'FAILED',
            errorSummary: 'The uploaded file contains no data rows.',
          },
        });
        return (this.prisma as any).translationImport.findUnique({
          where: { id: importId },
        });
      }

      // Build in-memory cache for questions, options, and languages
      const [questions, languages, existingTranslations] = await Promise.all([
        this.prisma.question.findMany({
          select: {
            id: true,
            type: true,
            options: {
              select: { id: true, optionKey: true, displayOrder: true },
            },
          },
        }),
        this.prisma.preferredLanguage.findMany({
          select: { id: true, code: true, name: true, nativeName: true, isActive: true },
        }),
        this.prisma.questionTranslation.findMany({
          select: { questionId: true, languageId: true },
        }),
      ]);

      const questionMap = new Map<string, { id: string; type: string; options: any[] }>();
      for (const q of questions) {
        questionMap.set(q.id.toLowerCase(), q);
      }

      const languageMap = new Map<string, { id: string; code: string; name: string; nativeName: string; isActive: boolean }>();
      for (const lang of languages) {
        languageMap.set(lang.code.toLowerCase(), lang);
      }

      const existingTranslationSet = new Set<string>();
      for (const tr of existingTranslations) {
        existingTranslationSet.add(`${tr.questionId.toLowerCase()}_${tr.languageId.toLowerCase()}`);
      }

      // Track duplicate (question_id, language_code) pairs within file
      const seenInFile = new Set<string>();

      let validCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;
      let updateCount = 0;
      let createCount = 0;

      const stagingRowsData: any[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const rowNumber = i + 1;
        const raw = rawRows[i];
        const errors: string[] = [];
        const warnings: string[] = [];

        const rawQuestionId = String(raw.question_id || raw.questionId || '').trim();
        const rawLanguageCode = String(raw.language_code || raw.languageCode || raw.lang || '').trim().toLowerCase();
        const rawQuestionText = String(raw.question_text || raw.questionText || raw.text || '').trim();

        if (!rawQuestionId) {
          errors.push("Missing required field 'question_id'.");
        }
        if (!rawLanguageCode) {
          errors.push("Missing required field 'language_code'.");
        }
        if (!rawQuestionText) {
          errors.push("Missing required field 'question_text'.");
        }

        const matchedQuestion = questionMap.get(rawQuestionId.toLowerCase());
        if (rawQuestionId && !matchedQuestion) {
          errors.push(`Question with ID '${rawQuestionId}' does not exist in the database.`);
        }

        const matchedLanguage = languageMap.get(rawLanguageCode);
        if (rawLanguageCode && !matchedLanguage) {
          errors.push(`Language with code '${rawLanguageCode}' is not supported or active.`);
        }

        // Check duplicate within file
        const fileKey = `${rawQuestionId.toLowerCase()}_${rawLanguageCode}`;
        if (seenInFile.has(fileKey)) {
          errors.push(`Duplicate translation entry for question '${rawQuestionId}' in language '${rawLanguageCode}' found in file.`);
        } else if (rawQuestionId && rawLanguageCode) {
          seenInFile.add(fileKey);
        }

        let action: 'CREATE' | 'UPDATE' | 'NONE' = 'CREATE';
        let rowStatus: string = 'PENDING';

        if (errors.length > 0) {
          if (errors.some((e) => e.includes('Duplicate'))) {
            rowStatus = 'DUPLICATE_IN_FILE';
            duplicateCount++;
          } else {
            rowStatus = 'INVALID';
            invalidCount++;
          }
          action = 'NONE';
        } else if (matchedQuestion && matchedLanguage) {
          const translationKey = `${matchedQuestion.id.toLowerCase()}_${matchedLanguage.id.toLowerCase()}`;
          const alreadyExists = existingTranslationSet.has(translationKey);

          if (alreadyExists) {
            action = 'UPDATE';
            rowStatus = 'UPDATE_AVAILABLE';
            updateCount++;
          } else {
            action = 'CREATE';
            rowStatus = 'VALID';
            createCount++;
          }
          validCount++;
        }

        // Build option translations map
        const optionTranslations: { optionId: string; optionKey: string; optionText: string }[] = [];
        if (matchedQuestion && matchedQuestion.options.length > 0) {
          for (const opt of matchedQuestion.options) {
            const keyLower = opt.optionKey.toLowerCase();
            const translatedOptText = String(
              raw[`option_${keyLower}`] || raw[`option${opt.optionKey}`] || '',
            ).trim();
            if (translatedOptText) {
              optionTranslations.push({
                optionId: opt.id,
                optionKey: opt.optionKey,
                optionText: translatedOptText,
              });
            }
          }
        }

        const normalized: NormalizedTranslationRowData = {
          question_id: rawQuestionId,
          language_code: rawLanguageCode,
          question_text: rawQuestionText,
          passage_text: raw.passage_text || raw.passage || undefined,
          assertion_text: raw.assertion_text || raw.assertion || undefined,
          reason_text: raw.reason_text || raw.reason || undefined,
          option_a: raw.option_a || undefined,
          option_b: raw.option_b || undefined,
          option_c: raw.option_c || undefined,
          option_d: raw.option_d || undefined,
          option_e: raw.option_e || undefined,
          option_f: raw.option_f || undefined,
          explanation: raw.explanation || undefined,
        };

        const dtoData = {
          questionId: matchedQuestion?.id,
          languageId: matchedLanguage?.id,
          questionText: rawQuestionText,
          passageText: raw.passage_text || raw.passage || null,
          assertionText: raw.assertion_text || raw.assertion || null,
          reasonText: raw.reason_text || raw.reason || null,
          explanation: raw.explanation || null,
          optionTranslations,
        };

        stagingRowsData.push({
          importId,
          rowNumber,
          status: rowStatus,
          action,
          targetQuestionId: matchedQuestion?.id || null,
          targetLanguageId: matchedLanguage?.id || null,
          languageCode: rawLanguageCode || null,
          rawData: raw,
          normalizedData: normalized,
          dtoData,
          errors: errors.length > 0 ? errors : null,
          warnings: warnings.length > 0 ? warnings : null,
        });
      }

      // Delete existing staging rows if re-parsing
      await (this.prisma as any).translationImportRow.deleteMany({
        where: { importId },
      });

      // Insert all staging rows
      await (this.prisma as any).translationImportRow.createMany({
        data: stagingRowsData,
      });

      // Update import summary counters
      const updatedSession = await (this.prisma as any).translationImport.update({
        where: { id: importId },
        data: {
          status: 'READY_TO_IMPORT',
          totalRows: rawRows.length,
          validRows: validCount,
          invalidRows: invalidCount,
          duplicateRows: duplicateCount,
          updateRows: updateCount,
          createRows: createCount,
        },
      });

      return updatedSession;
    } catch (err: any) {
      this.logger.error(`Validation failed for import ${importId}: ${err.message}`, err.stack);
      await (this.prisma as any).translationImport.update({
        where: { id: importId },
        data: {
          status: 'FAILED',
          errorSummary: err.message || 'Spreadsheet parsing failed.',
        },
      });
      return (this.prisma as any).translationImport.findUnique({
        where: { id: importId },
      });
    }
  }

  /**
   * Get single translation import session
   */
  async getImportSession(importId: string) {
    const session = await (this.prisma as any).translationImport.findUnique({
      where: { id: importId },
      include: {
        createdBy: {
          select: { id: true, email: true, mobileNumber: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Translation import session '${importId}' not found.`);
    }

    return session;
  }

  /**
   * Get paginated staging rows
   */
  async getImportRows(importId: string, filterDto: TranslationImportFilterDto) {
    const { status, page = 1, limit = 20, languageCode, search } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = { importId };

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (languageCode) {
      where.languageCode = languageCode.toLowerCase();
    }

    if (search) {
      where.OR = [
        { targetQuestionId: { contains: search, mode: 'insensitive' } },
        { languageCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).translationImportRow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { rowNumber: 'asc' },
      }),
      (this.prisma as any).translationImportRow.count({ where }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update an imported staging translation row and re-validate
   */
  async updateImportRow(
    importId: string,
    rowId: string,
    dto: UpdateTranslationImportRowDto,
  ) {
    const row = await (this.prisma as any).translationImportRow.findFirst({
      where: { id: rowId, importId },
    });

    if (!row) {
      throw new NotFoundException(`Translation row '${rowId}' not found.`);
    }

    const raw = (dto.rawData || row.rawData) as Record<string, any>;
    const rawQuestionId = String(raw.question_id || raw.questionId || '').trim();
    const rawLanguageCode = String(raw.language_code || raw.languageCode || raw.lang || '').trim().toLowerCase();
    const rawQuestionText = String(raw.question_text || raw.questionText || raw.text || '').trim();

    const errors: string[] = [];
    if (!rawQuestionId) errors.push("Missing required field 'question_id'.");
    if (!rawLanguageCode) errors.push("Missing required field 'language_code'.");
    if (!rawQuestionText) errors.push("Missing required field 'question_text'.");

    const [matchedQuestion, matchedLanguage] = await Promise.all([
      rawQuestionId
        ? this.prisma.question.findUnique({
            where: { id: rawQuestionId },
            include: { options: true },
          })
        : null,
      rawLanguageCode
        ? this.prisma.preferredLanguage.findFirst({
            where: { code: rawLanguageCode, isActive: true },
          })
        : null,
    ]);

    if (rawQuestionId && !matchedQuestion) {
      errors.push(`Question with ID '${rawQuestionId}' does not exist in database.`);
    }
    if (rawLanguageCode && !matchedLanguage) {
      errors.push(`Language with code '${rawLanguageCode}' is not supported or active.`);
    }

    let action: 'CREATE' | 'UPDATE' | 'NONE' = 'CREATE';
    let status: string = 'PENDING';

    if (errors.length > 0) {
      status = 'INVALID';
      action = 'NONE';
    } else if (matchedQuestion && matchedLanguage) {
      const existing = await this.prisma.questionTranslation.findUnique({
        where: {
          questionId_languageId: {
            questionId: matchedQuestion.id,
            languageId: matchedLanguage.id,
          },
        },
      });
      if (existing) {
        action = 'UPDATE';
        status = 'UPDATE_AVAILABLE';
      } else {
        action = 'CREATE';
        status = 'VALID';
      }
    }

    const optionTranslations: { optionId: string; optionKey: string; optionText: string }[] = [];
    if (matchedQuestion && matchedQuestion.options.length > 0) {
      for (const opt of matchedQuestion.options) {
        const keyLower = opt.optionKey.toLowerCase();
        const translatedOptText = String(
          raw[`option_${keyLower}`] || raw[`option${opt.optionKey}`] || '',
        ).trim();
        if (translatedOptText) {
          optionTranslations.push({
            optionId: opt.id,
            optionKey: opt.optionKey,
            optionText: translatedOptText,
          });
        }
      }
    }

    const dtoData = {
      questionId: matchedQuestion?.id,
      languageId: matchedLanguage?.id,
      questionText: rawQuestionText,
      passageText: raw.passage_text || raw.passage || null,
      assertionText: raw.assertion_text || raw.assertion || null,
      reasonText: raw.reason_text || raw.reason || null,
      explanation: raw.explanation || null,
      optionTranslations,
    };

    const updated = await (this.prisma as any).translationImportRow.update({
      where: { id: rowId },
      data: {
        rawData: raw,
        dtoData,
        status,
        action: dto.action || action,
        targetQuestionId: matchedQuestion?.id || null,
        targetLanguageId: matchedLanguage?.id || null,
        languageCode: rawLanguageCode || null,
        errors: errors.length > 0 ? errors : null,
      },
    });

    // Refresh import counters
    await this.refreshImportCounters(importId);

    return updated;
  }

  /**
   * Confirm & execute batch translation import
   */
  async executeImport(importId: string, userId: string) {
    const importRecord = await (this.prisma as any).translationImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException(`Translation import session '${importId}' not found.`);
    }

    await (this.prisma as any).translationImport.update({
      where: { id: importId },
      data: { status: 'IMPORTING' },
    });

    const eligibleRows = await (this.prisma as any).translationImportRow.findMany({
      where: {
        importId,
        status: { in: ['VALID', 'UPDATE_AVAILABLE'] },
      },
      orderBy: { rowNumber: 'asc' },
    });

    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    for (const row of eligibleRows) {
      const dto = row.dtoData as any;
      if (!dto || !dto.questionId || !dto.languageId) {
        await (this.prisma as any).translationImportRow.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            importStatus: 'FAILED',
            importError: 'Missing question or language association.',
          },
        });
        failedCount++;
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          // 1. Upsert QuestionTranslation
          const tr = await tx.questionTranslation.upsert({
            where: {
              questionId_languageId: {
                questionId: dto.questionId,
                languageId: dto.languageId,
              },
            },
            create: {
              questionId: dto.questionId,
              languageId: dto.languageId,
              questionText: dto.questionText,
              passageText: dto.passageText || null,
              assertionText: dto.assertionText || null,
              reasonText: dto.reasonText || null,
              explanation: dto.explanation || null,
            },
            update: {
              questionText: dto.questionText,
              passageText: dto.passageText !== undefined ? dto.passageText : undefined,
              assertionText: dto.assertionText !== undefined ? dto.assertionText : undefined,
              reasonText: dto.reasonText !== undefined ? dto.reasonText : undefined,
              explanation: dto.explanation !== undefined ? dto.explanation : undefined,
            },
          });

          // 2. Upsert OptionTranslations
          if (dto.optionTranslations && dto.optionTranslations.length > 0) {
            for (const optTr of dto.optionTranslations) {
              await tx.questionOptionTranslation.upsert({
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
            }
          }

          const isUpdate = row.action === 'UPDATE';
          if (isUpdate) updatedCount++;
          else createdCount++;

          await (tx as any).translationImportRow.update({
            where: { id: row.id },
            data: {
              status: isUpdate ? 'UPDATED' : 'CREATED',
              importStatus: 'SUCCESS',
              resultTranslationId: tr.id,
            },
          });
        });
      } catch (err: any) {
        failedCount++;
        this.logger.error(`Row ${row.rowNumber} execution failed: ${err.message}`);
        await (this.prisma as any).translationImportRow.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            importStatus: 'FAILED',
            importError: err.message || 'Failed to upsert translation.',
          },
        });
      }
    }

    const completed = await (this.prisma as any).translationImport.update({
      where: { id: importId },
      data: {
        status: failedCount > 0 && createdCount + updatedCount === 0 ? 'FAILED' : 'COMPLETED',
        processedRows: eligibleRows.length,
        createdCount,
        updatedCount,
        failedCount,
        completedAt: new Date(),
      },
    });

    return completed;
  }

  /**
   * Cancel an import session
   */
  async cancelImportSession(importId: string) {
    const session = await (this.prisma as any).translationImport.findUnique({
      where: { id: importId },
    });
    if (!session) {
      throw new NotFoundException(`Translation import session '${importId}' not found.`);
    }

    const cancelled = await (this.prisma as any).translationImport.update({
      where: { id: importId },
      data: { status: 'CANCELLED' },
    });

    return cancelled;
  }

  /**
   * Generate Error Report for download
   */
  async generateErrorReport(
    importId: string,
    format: TranslationImportFormatEnum = TranslationImportFormatEnum.XLSX,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const failedRows = await (this.prisma as any).translationImportRow.findMany({
      where: {
        importId,
        status: { in: ['INVALID', 'DUPLICATE_IN_FILE', 'FAILED'] },
      },
      orderBy: { rowNumber: 'asc' },
    });

    if (format === TranslationImportFormatEnum.CSV) {
      const headers = ['Row Number', 'Status', 'Question ID', 'Language Code', 'Error Reasons'];
      const csvLines = [headers.join(',')];
      for (const row of failedRows) {
        const errors = (row.errors as string[]) || [];
        if (row.importError) errors.push(row.importError);
        const line = [
          row.rowNumber,
          row.status,
          `"${row.targetQuestionId || ''}"`,
          `"${row.languageCode || ''}"`,
          `"${errors.join('; ').replace(/"/g, '""')}"`,
        ].join(',');
        csvLines.push(line);
      }
      return {
        buffer: Buffer.from(csvLines.join('\n'), 'utf-8'),
        fileName: `translation_import_errors_${importId.slice(0, 8)}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Failed Translations');

    worksheet.columns = [
      { header: 'Row #', key: 'rowNumber', width: 10 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Question ID', key: 'questionId', width: 40 },
      { header: 'Language Code', key: 'languageCode', width: 16 },
      { header: 'Error Diagnostics', key: 'errors', width: 60 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE11D48' },
    };

    for (const row of failedRows) {
      const errors = (row.errors as string[]) || [];
      if (row.importError) errors.push(row.importError);
      worksheet.addRow({
        rowNumber: row.rowNumber,
        status: row.status,
        questionId: row.targetQuestionId || (row.rawData as any)?.question_id || '',
        languageCode: row.languageCode || (row.rawData as any)?.language_code || '',
        errors: errors.join('; '),
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `translation_import_errors_${importId.slice(0, 8)}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async refreshImportCounters(importId: string) {
    const rows = await (this.prisma as any).translationImportRow.findMany({
      where: { importId },
      select: { status: true },
    });

    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;
    let updateRows = 0;
    let createRows = 0;

    for (const r of rows) {
      if (r.status === 'VALID') {
        validRows++;
        createRows++;
      } else if (r.status === 'UPDATE_AVAILABLE') {
        validRows++;
        updateRows++;
      } else if (r.status === 'INVALID') {
        invalidRows++;
      } else if (r.status === 'DUPLICATE_IN_FILE') {
        duplicateRows++;
      }
    }

    await (this.prisma as any).translationImport.update({
      where: { id: importId },
      data: {
        validRows,
        invalidRows,
        duplicateRows,
        updateRows,
        createRows,
      },
    });
  }

  private async parseFileToRows(
    buffer: Buffer,
    fileName: string,
  ): Promise<Record<string, any>[]> {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const worksheet = workbook.getWorksheet('Translations') || workbook.worksheets[0];
      if (!worksheet) {
        throw new BadRequestException('Excel workbook has no sheets.');
      }

      const headers: string[] = [];
      const rows: Record<string, any>[] = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, colNumber) => {
            headers[colNumber - 1] = String(cell.value || '')
              .trim()
              .toLowerCase();
          });
          return;
        }

        const rowData: Record<string, any> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            let val = cell.value;
            if (val && typeof val === 'object') {
              if ('result' in (val as any)) val = (val as any).result;
              else if ('text' in (val as any)) val = (val as any).text;
              else if ('richText' in (val as any)) {
                val = (val as any).richText.map((t: any) => t.text).join('');
              }
            }
            rowData[header] = val != null ? String(val).trim() : '';
          }
        });

        if (Object.values(rowData).some((v) => v !== '')) {
          rows.push(rowData);
        }
      });

      return rows;
    }

    // CSV Parser
    const content = buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must have a header and data rows.');
    }

    const headers = this.parseCsvLine(lines[0]).map((h) =>
      h.trim().toLowerCase().replace(/['"]/g, ''),
    );
    const rows: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const values = this.parseCsvLine(line);
      const rowData: Record<string, any> = {};

      headers.forEach((header, idx) => {
        rowData[header] = values[idx] != null ? values[idx].trim() : '';
      });

      if (Object.values(rowData).some((v) => v !== '')) {
        rows.push(rowData);
      }
    }

    return rows;
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }
}
