import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { LanguageService } from './language.service';
import { RedisService } from '../../redis/redis.service';
import {
  ExamTranslationExportFormat,
  ExamTranslationCoverageResponse,
  ExamLanguageCoverageItem,
  ExamTranslationValidationResponse,
  ExamTranslationRowDiff,
  ExamTranslationTargetsQueryDto,
  TranslationTargetItem,
  TranslationTargetsResponse,
} from '../dto/exam-translation.dto';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

@Injectable()
export class ExamTranslationService {
  private readonly logger = new Logger(ExamTranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly languageService: LanguageService,
    private readonly redisService: RedisService,
    @InjectQueue('translation-import')
    private readonly translationQueue: Queue,
  ) {}

  /**
   * Helper: Validate raw uploaded file format and size
   */
  private validateRawFile(file: { originalname: string; size: number; buffer: Buffer }) {
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
   * Helper: Retrieve all questions and options associated with an exam across all sections
   */
  async getExamQuestionsAndOptions(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        status: true,
        examTarget: true,
        languages: {
          include: { language: true },
          orderBy: { displayOrder: 'asc' },
        },
        sections: {
          include: {
            examQuestions: {
              include: {
                question: {
                  include: {
                    options: { orderBy: { displayOrder: 'asc' } },
                    translations: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found.`);
    }

    // Flatten questions across all sections
    const questionMap = new Map<string, any>();
    for (const section of exam.sections || []) {
      for (const eq of section.examQuestions || []) {
        if (eq.question && !questionMap.has(eq.question.id)) {
          questionMap.set(eq.question.id, eq.question);
        }
      }
    }

    const questions = Array.from(questionMap.values());
    const totalOptions = questions.reduce((acc, q) => acc + (q.options?.length || 0), 0);

    return {
      exam,
      questions,
      totalQuestions: questions.length,
      totalOptions,
    };
  }

  /**
   * 1. Get Translation Coverage Breakdown for an Exam / Mock across all languages
   */
  async getExamTranslationCoverage(examId: string): Promise<ExamTranslationCoverageResponse> {
    const { exam, questions, totalQuestions, totalOptions } =
      await this.getExamQuestionsAndOptions(examId);

    // Fetch all active system languages
    const allActiveLanguages = await this.languageService.getAllLanguages(false);

    // Map configured languages for quick lookup
    const configuredExamLangsMap = new Map<string, any>();
    for (const el of exam.languages || []) {
      configuredExamLangsMap.set(el.languageId, el);
    }

    const questionIds = questions.map((q) => q.id);

    // Fetch all question & option translations for these questions
    const [allQuestionTranslations, allOptionTranslations] = await Promise.all([
      this.prisma.questionTranslation.findMany({
        where: { questionId: { in: questionIds } },
        select: {
          questionId: true,
          languageId: true,
          questionText: true,
          updatedAt: true,
        },
      }),
      this.prisma.questionOptionTranslation.findMany({
        where: {
          option: { questionId: { in: questionIds } },
        },
        select: {
          optionId: true,
          languageId: true,
          optionText: true,
          updatedAt: true,
        },
      }),
    ]);

    const languageCoverageList: ExamLanguageCoverageItem[] = await Promise.all(
      allActiveLanguages.map(async (lang: any) => {
        const langId = lang.id;
        const configuredEl = configuredExamLangsMap.get(langId);
        const isDefault = Boolean(configuredEl?.isDefault) || lang.code?.toLowerCase() === 'en';

        // Check Redis for active/recent job status
        const redisStatusRaw = await this.redisService.get(
          `translation:status:${examId}:${langId}`,
        );
        let redisJob: any = null;
        if (redisStatusRaw) {
          try {
            redisJob = JSON.parse(redisStatusRaw);
          } catch {
            redisJob = null;
          }
        }

        // Filter translations for this language
        const qTranslations = allQuestionTranslations.filter(
          (qt) => qt.languageId === langId && Boolean(qt.questionText?.trim()),
        );
        const translatedQIds = new Set(qTranslations.map((qt) => qt.questionId));

        const optTranslations = allOptionTranslations.filter(
          (ot) => ot.languageId === langId && Boolean(ot.optionText?.trim()),
        );

        const translatedQuestionsCount = translatedQIds.size;
        const translatedOptionsCount = optTranslations.length;

        const questionCoveragePercentage =
          totalQuestions > 0
            ? Math.round((translatedQuestionsCount / totalQuestions) * 100)
            : 0;

        const optionCoveragePercentage =
          totalOptions > 0
            ? Math.round((translatedOptionsCount / totalOptions) * 100)
            : 0;

        const overallCoveragePercentage =
          totalQuestions > 0
            ? Math.round(
                ((translatedQuestionsCount + translatedOptionsCount) /
                  (totalQuestions + totalOptions || 1)) *
                  100,
              )
            : 0;

        const missingQuestionIds = questions
          .filter((q) => !translatedQIds.has(q.id))
          .map((q) => q.id);

        let status:
          | 'NOT_ADDED'
          | 'PROCESSING'
          | 'COMPLETED'
          | 'FAILED'
          | 'IN_PROGRESS' = 'NOT_ADDED';

        if (redisJob?.status === 'PROCESSING') {
          status = 'PROCESSING';
        } else if (redisJob?.status === 'FAILED') {
          status = 'FAILED';
        } else if (
          isDefault ||
          questionCoveragePercentage >= 100 ||
          redisJob?.status === 'COMPLETED'
        ) {
          status = 'COMPLETED';
        } else if (translatedQuestionsCount > 0 || translatedOptionsCount > 0) {
          status = 'IN_PROGRESS';
        } else {
          status = 'NOT_ADDED';
        }

        // Find latest updated timestamp
        const allTimestamps = [
          ...qTranslations.map((t) => t.updatedAt?.getTime() || 0),
          ...optTranslations.map((t) => t.updatedAt?.getTime() || 0),
        ];
        const maxTs = allTimestamps.length > 0 ? Math.max(...allTimestamps) : null;

        return {
          languageId: langId,
          languageCode: lang.code,
          languageName: lang.name,
          nativeName: lang.nativeName,
          isDefault,
          totalQuestions,
          translatedQuestions: translatedQuestionsCount,
          questionCoveragePercentage,
          totalOptions,
          translatedOptions: translatedOptionsCount,
          optionCoveragePercentage,
          overallCoveragePercentage,
          status,
          missingQuestionsCount: missingQuestionIds.length,
          missingQuestionIds,
          lastUpdatedAt: maxTs ? new Date(maxTs).toISOString() : null,
          jobId: redisJob?.jobId,
          processingError: redisJob?.error || null,
        };
      }),
    );

    const overallCompleteness =
      languageCoverageList.length > 0
        ? Math.round(
            languageCoverageList.reduce((acc, l) => acc + l.overallCoveragePercentage, 0) /
              languageCoverageList.length,
          )
        : 0;

    const isAllRequiredComplete = languageCoverageList.every(
      (l) => l.status === 'COMPLETED' || l.status === 'COMPLETE',
    );

    return {
      examId,
      examTitle: exam.title,
      totalQuestions,
      totalOptions,
      languages: languageCoverageList,
      overallCompletenessPercentage: overallCompleteness,
      isAllRequiredComplete,
    };
  }

  /**
   * Enqueue Translation Import as an Asynchronous BullMQ Job
   */
  async enqueueTranslationImport(
    examId: string,
    languageId: string,
    file: { originalname: string; size: number; buffer: Buffer },
    userId: string,
    replaceMode = false,
  ) {
    this.validateRawFile(file);

    // 1. Verify exam existence and access
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { id: true, title: true, status: true },
    });
    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found.`);
    }

    // 2. Verify selected language
    const language = await this.languageService.getLanguageById(languageId);
    if (!language) {
      throw new NotFoundException(`Language with ID '${languageId}' not found.`);
    }

    // 3. Duplicate protection: Reject if job is currently PROCESSING
    const redisKey = `translation:status:${examId}:${languageId}`;
    const currentRaw = await this.redisService.get(redisKey);
    if (currentRaw) {
      try {
        const current = JSON.parse(currentRaw);
        if (current.status === 'PROCESSING') {
          throw new BadRequestException(
            `A translation import is already processing for ${language.name}. Please wait for it to complete.`,
          );
        }
      } catch (e: any) {
        if (e instanceof BadRequestException) throw e;
      }
    }

    // 4. Mark status in Redis as PROCESSING immediately
    const processingState = {
      status: 'PROCESSING',
      fileName: file.originalname,
      startedAt: new Date().toISOString(),
    };
    await this.redisService.set(redisKey, JSON.stringify(processingState), 86400);

    // 5. Create idempotent BullMQ job
    const jobId = `trans_${examId}_${languageId}_${Date.now()}`;
    await this.translationQueue.add(
      'import-exam-translation',
      {
        examId,
        languageId,
        userId,
        fileName: file.originalname,
        fileBufferBase64: file.buffer.toString('base64'),
        replaceMode,
        uploadedAt: new Date().toISOString(),
      },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      `[enqueueTranslationImport] Enqueued BullMQ translation job ${jobId} for exam ${examId}, language ${language.name}`,
    );

    return {
      jobId,
      status: 'PROCESSING',
      message: 'Translation upload started. Processing in background...',
      examId,
      languageId,
      languageName: language.name,
    };
  }

  /**
   * 2. Generate Pre-filled Downloadable Translation Template for a specific exam & language
   */
  async generateExamTranslationTemplate(
    examId: string,
    languageId: string,
    format: ExamTranslationExportFormat = ExamTranslationExportFormat.XLSX,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const { exam, questions } = await this.getExamQuestionsAndOptions(examId);
    const language = await this.languageService.getLanguageById(languageId);

    // Fetch existing translations for reference/prefilling
    const questionIds = questions.map((q) => q.id);
    const [existingQTranslations, existingOptTranslations] = await Promise.all([
      this.prisma.questionTranslation.findMany({
        where: { questionId: { in: questionIds }, languageId },
      }),
      this.prisma.questionOptionTranslation.findMany({
        where: {
          option: { questionId: { in: questionIds } },
          languageId,
        },
        include: { option: true },
      }),
    ]);

    const qTrMap = new Map(existingQTranslations.map((t) => [t.questionId, t]));

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

    const rows: any[] = [];

    for (const q of questions) {
      const tr = qTrMap.get(q.id);
      const optMap = new Map<string, string>();

      for (const opt of q.options || []) {
        const optKey = (opt.optionKey || 'A').toLowerCase();
        const existingOptTr = existingOptTranslations.find((ot) => ot.optionId === opt.id);
        optMap.set(`option_${optKey}`, existingOptTr?.optionText || opt.optionText || '');
      }

      rows.push({
        question_id: q.id,
        language_code: language.code,
        question_text: tr?.questionText || q.questionText || '',
        passage_text: tr?.passageText || q.passageText || '',
        assertion_text: tr?.assertionText || q.assertionText || '',
        reason_text: tr?.reasonText || q.reasonText || '',
        option_a: optMap.get('option_a') || '',
        option_b: optMap.get('option_b') || '',
        option_c: optMap.get('option_c') || '',
        option_d: optMap.get('option_d') || '',
        option_e: optMap.get('option_e') || '',
        option_f: optMap.get('option_f') || '',
        explanation: tr?.explanation || q.explanation || '',
      });
    }

    const safeExamTitle = exam.title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    if (format === ExamTranslationExportFormat.CSV) {
      const csvLines = [headers.join(',')];
      for (const row of rows) {
        const line = headers
          .map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`)
          .join(',');
        csvLines.push(line);
      }
      return {
        buffer: Buffer.from(csvLines.join('\n'), 'utf-8'),
        fileName: `${safeExamTitle}_translation_${language.code}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Brainros Exam Management';
    const langCode = (language.code || 'default').toUpperCase();
    const sheet = workbook.addWorksheet(`Translations_${langCode}`);

    sheet.columns = [
      { header: 'question_id', key: 'question_id', width: 38 },
      { header: 'language_code', key: 'language_code', width: 15 },
      { header: 'question_text', key: 'question_text', width: 50 },
      { header: 'passage_text', key: 'passage_text', width: 30 },
      { header: 'assertion_text', key: 'assertion_text', width: 30 },
      { header: 'reason_text', key: 'reason_text', width: 30 },
      { header: 'option_a', key: 'option_a', width: 25 },
      { header: 'option_b', key: 'option_b', width: 25 },
      { header: 'option_c', key: 'option_c', width: 25 },
      { header: 'option_d', key: 'option_d', width: 25 },
      { header: 'option_e', key: 'option_e', width: 20 },
      { header: 'option_f', key: 'option_f', width: 20 },
      { header: 'explanation', key: 'explanation', width: 40 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }, // Indigo-600
    };

    for (const r of rows) {
      sheet.addRow(r);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `${safeExamTitle}_translation_${language.code}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * Helper: Parse uploaded Excel / CSV buffer into structured records
   */
  private async parseFileBuffer(buffer: Buffer, originalName: string): Promise<any[]> {
    const ext = path.extname(originalName).toLowerCase();
    const rows: any[] = [];

    if (ext === '.csv') {
      const content = buffer.toString('utf-8');
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) return [];

      const headers = lines[0]
        .split(',')
        .map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());

      for (let i = 1; i < lines.length; i++) {
        // Safe CSV parser handling quoted comma values
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let j = 0; j < lines[i].length; j++) {
          const char = lines[i][j];
          if (char === '"') {
            if (inQuotes && lines[i][j + 1] === '"') {
              current += '"';
              j++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        const rowObj: Record<string, any> = {};
        headers.forEach((h, idx) => {
          rowObj[h] = values[idx] ?? '';
        });
        rows.push(rowObj);
      }
      return rows;
    }

    // XLSX / XLS Parser
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const headers: string[] = [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value || '')
        .trim()
        .toLowerCase();
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      const rowObj: Record<string, any> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rowObj[header] = cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
        }
      });
      if (Object.keys(rowObj).length > 0) {
        rows.push(rowObj);
      }
    });

    return rows;
  }

  /**
   * 3. Validate Uploaded Translation File against target Exam/Mock questions
   */
  async validateExamTranslationFile(
    examId: string,
    languageId: string,
    file: { originalname: string; size: number; buffer: Buffer },
  ): Promise<ExamTranslationValidationResponse> {
    this.validateRawFile(file);

    const { exam, questions, totalQuestions } =
      await this.getExamQuestionsAndOptions(examId);
    const language = await this.languageService.getLanguageById(languageId);

    const rawRows = await this.parseFileBuffer(file.buffer, file.originalname);

    if (rawRows.length === 0) {
      throw new BadRequestException('The uploaded file contains no data rows.');
    }

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const questionIds = questions.map((q) => q.id);

    // Fetch existing translations for diff calculations
    const existingQTranslations = await this.prisma.questionTranslation.findMany({
      where: { questionId: { in: questionIds }, languageId },
    });
    const existingQTrMap = new Map(existingQTranslations.map((t) => [t.questionId, t]));

    const seenQuestionIds = new Set<string>();
    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const globalErrors: string[] = [];
    const rowDetails: ExamTranslationRowDiff[] = [];

    rawRows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const qId = String(row.question_id || row.id || '').trim();
      const qText = String(row.question_text || '').trim();
      const rowErrors: string[] = [];

      if (!qId) {
        rowErrors.push('Missing question_id in row.');
      } else if (!questionMap.has(qId)) {
        rowErrors.push(`Question ID '${qId}' does not belong to this exam.`);
      }

      if (qId && seenQuestionIds.has(qId)) {
        rowErrors.push(`Duplicate translation entry for question '${qId}' in this file.`);
        duplicateRows++;
      }
      if (qId) seenQuestionIds.add(qId);

      if (!qText) {
        rowErrors.push('question_text cannot be empty.');
      }

      const targetQuestion = questionMap.get(qId);
      let action: 'NEW' | 'UPDATE' | 'UNCHANGED' | 'INVALID' = 'INVALID';
      let translatedOptsCount = 0;
      const totalOptsCount = targetQuestion?.options?.length || 0;

      if (rowErrors.length === 0 && targetQuestion) {
        // Count provided options
        ['option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f'].forEach((key) => {
          if (row[key] && String(row[key]).trim().length > 0) {
            translatedOptsCount++;
          }
        });

        const existing = existingQTrMap.get(qId);
        if (!existing) {
          action = 'NEW';
          newCount++;
        } else if (
          existing.questionText === qText &&
          existing.explanation === (row.explanation || null)
        ) {
          action = 'UNCHANGED';
          unchangedCount++;
        } else {
          action = 'UPDATE';
          updatedCount++;
        }
        validRows++;
      } else {
        invalidRows++;
      }

      rowDetails.push({
        rowNumber: rowNum,
        questionId: qId,
        questionText: qText || '(Empty)',
        action,
        translatedOptionsCount: translatedOptsCount,
        totalOptionsCount: totalOptsCount,
        errors: rowErrors,
      });
    });

    const coveredQuestionsCount = new Set([
      ...Array.from(existingQTrMap.keys()),
      ...Array.from(seenQuestionIds).filter((id) => questionMap.has(id)),
    ]).size;

    const coverageAfterImportPercentage =
      totalQuestions > 0 ? Math.round((coveredQuestionsCount / totalQuestions) * 100) : 0;

    const missingExamQuestionsCount = Math.max(0, totalQuestions - coveredQuestionsCount);

    return {
      examId,
      languageId,
      languageName: language.name,
      languageCode: language.code || 'en',
      fileName: file.originalname,
      totalRows: rawRows.length,
      validRows,
      invalidRows,
      duplicateRows,
      newTranslationsCount: newCount,
      updatedTranslationsCount: updatedCount,
      unchangedTranslationsCount: unchangedCount,
      missingExamQuestionsCount,
      coverageAfterImportPercentage,
      rowDetails,
      errors: globalErrors,
    };
  }

  /**
   * 4. Confirm and Execute Transactional Import for an Exam / Mock
   */
  async importExamTranslations(
    examId: string,
    languageId: string,
    file: { originalname: string; size: number; buffer: Buffer },
    userId: string,
    replaceMode = false,
  ) {
    // 1. Run validation
    const validation = await this.validateExamTranslationFile(examId, languageId, file);

    if (validation.validRows === 0) {
      throw new BadRequestException(
        'Cannot import translation file: 0 valid rows found. Please fix file errors.',
      );
    }

    const { exam, questions } = await this.getExamQuestionsAndOptions(examId);
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    // Check version immutability: If exam has existing attempts, protect active and historical record
    const hasAttempts = await this.prisma.attempt.count({
      where: { examId },
    });
    const effectiveReplaceMode = hasAttempts > 0 ? false : replaceMode;
    if (hasAttempts > 0) {
      this.logger.log(
        `Exam '${examId}' has ${hasAttempts} attempts. Enforcing safe non-destructive translation upsert mode to protect historical and active attempts.`,
      );
    }

    const rawRows = await this.parseFileBuffer(file.buffer, file.originalname);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. If effectiveReplaceMode, delete existing translations for this language on this exam's questions
      if (effectiveReplaceMode) {
        const qIds = questions.map((q) => q.id);
        await tx.questionOptionTranslation.deleteMany({
          where: {
            option: { questionId: { in: qIds } },
            languageId,
          },
        });
        await tx.questionTranslation.deleteMany({
          where: {
            questionId: { in: qIds },
            languageId,
          },
        });
      }

      let importedQuestions = 0;
      let importedOptions = 0;

      for (const row of rawRows) {
        const qId = String(row.question_id || row.id || '').trim();
        const qText = String(row.question_text || '').trim();

        if (!qId || !qText || !questionMap.has(qId)) {
          continue; // Skip invalid rows
        }

        const question = questionMap.get(qId)!;

        // Upsert Question Translation
        await tx.questionTranslation.upsert({
          where: {
            questionId_languageId: { questionId: qId, languageId },
          },
          create: {
            questionId: qId,
            languageId,
            questionText: qText,
            passageText: row.passage_text ? String(row.passage_text).trim() : null,
            assertionText: row.assertion_text ? String(row.assertion_text).trim() : null,
            reasonText: row.reason_text ? String(row.reason_text).trim() : null,
            explanation: row.explanation ? String(row.explanation).trim() : null,
          },
          update: {
            questionText: qText,
            passageText: row.passage_text ? String(row.passage_text).trim() : null,
            assertionText: row.assertion_text ? String(row.assertion_text).trim() : null,
            reasonText: row.reason_text ? String(row.reason_text).trim() : null,
            explanation: row.explanation ? String(row.explanation).trim() : null,
          },
        });
        importedQuestions++;

        // Upsert Option Translations for options present in this question
        for (const opt of question.options || []) {
          const optKey = (opt.optionKey || 'A').toLowerCase();
          const translatedOptText = row[`option_${optKey}`];

          if (translatedOptText && String(translatedOptText).trim().length > 0) {
            await tx.questionOptionTranslation.upsert({
              where: {
                optionId_languageId: { optionId: opt.id, languageId },
              },
              create: {
                optionId: opt.id,
                languageId,
                optionText: String(translatedOptText).trim(),
              },
              update: {
                optionText: String(translatedOptText).trim(),
              },
            });
            importedOptions++;
          }
        }
      }

      // Ensure examLanguage record exists
      const existingExamLang = await tx.examLanguage.findUnique({
        where: {
          examId_languageId: { examId, languageId },
        },
      });

      if (!existingExamLang) {
        const langCount = await tx.examLanguage.count({ where: { examId } });
        await tx.examLanguage.create({
          data: {
            examId,
            languageId,
            isDefault: langCount === 0,
            displayOrder: langCount,
          },
        });
      }

      // Record Audit Event
      try {
        await (tx as any).auditLog.create({
          data: {
            action: replaceMode ? 'TRANSLATION_REPLACED' : 'TRANSLATION_IMPORTED',
            entity: 'ExamTranslation',
            entityId: examId,
            userId,
            details: {
              examId,
              languageId,
              fileName: file.originalname,
              importedQuestions,
              importedOptions,
              replaceMode,
            },
          },
        });
      } catch (err) {
        this.logger.warn(`AuditLog entry skipped: ${(err as any)?.message}`);
      }

      return {
        importedQuestions,
        importedOptions,
      };
    });

    // Recalculate fresh coverage breakdown
    const updatedCoverage = await this.getExamTranslationCoverage(examId);

    return {
      success: true,
      message: `Successfully imported ${result.importedQuestions} question translations and ${result.importedOptions} option translations.`,
      stats: result,
      coverage: updatedCoverage,
    };
  }

  /**
   * 5. List all Translation Targets (Exams, Mock Tests, Subject-wise Mocks)
   * Sorted by createdAt DESC with full coverage summary, search & filters
   */
  async getTranslationTargets(
    query: ExamTranslationTargetsQueryDto,
    currentUser: any,
  ): Promise<TranslationTargetsResponse> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    // Build Prisma Where Clause
    const where: any = {};

    // RBAC: If not SUPER_ADMIN, filter exams by admin scope
    if (currentUser?.role && currentUser.role !== 'SUPER_ADMIN') {
      where.OR = [
        { createdById: currentUser.id },
        { createdBy: { role: 'ADMIN' } },
      ];
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          {
            sections: {
              some: {
                subject: { name: { contains: term, mode: 'insensitive' } },
              },
            },
          },
        ],
      });
    }

    if (query.status && query.status !== 'ALL') {
      where.status = {
        name: { equals: query.status, mode: 'insensitive' },
      };
    }

    if (query.subjectId && query.subjectId !== 'ALL') {
      where.sections = {
        some: {
          subjectId: query.subjectId,
        },
      };
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    // Determine Sort Field
    const sortField = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    // Fetch Exams & Total Count
    const [total, rawExams, allActiveLanguages] = await Promise.all([
      this.prisma.exam.count({ where }),
      this.prisma.exam.findMany({
        where,
        include: {
          examTarget: true,
          status: true,
          createdBy: {
            select: {
              id: true,
              email: true,
              student: {
                select: {
                  name: true,
                },
              },
            },
          },
          sections: {
            include: {
              subject: true,
            },
            orderBy: { displayOrder: 'asc' },
          },
          languages: {
            include: {
              language: true,
            },
          },
          examQuestions: {
            select: {
              id: true,
              questionId: true,
              question: {
                select: {
                  id: true,
                  translations: {
                    select: {
                      languageId: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.preferredLanguage.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      }),
    ]);

    const activeLanguagesMap = new Map(allActiveLanguages.map((l) => [l.id, l]));

    // Map each exam to TranslationTargetItem
    const items: TranslationTargetItem[] = (rawExams as any[]).map((exam) => {
      // 1. Determine Subject(s)
      const distinctSubjectsMap = new Map<string, any>();
      for (const sec of exam.sections || []) {
        if (sec.subject && !distinctSubjectsMap.has(sec.subject.id)) {
          distinctSubjectsMap.set(sec.subject.id, sec.subject);
        }
      }
      const distinctSubjects = Array.from(distinctSubjectsMap.values());

      // 2. Classify Type: SUBJECT_MOCK vs MOCK vs LIVE_EXAM
      let type: 'LIVE_EXAM' | 'MOCK' | 'SUBJECT_MOCK' = 'LIVE_EXAM';
      let typeLabel = 'Live Exam';

      const titleUpper = exam.title.toUpperCase();
      const isMockNaming =
        titleUpper.includes('MOCK') ||
        titleUpper.includes('PRACTICE') ||
        titleUpper.includes('SAMPLE');

      if (distinctSubjects.length === 1) {
        type = 'SUBJECT_MOCK';
        typeLabel = 'Subject Mock';
      } else if (isMockNaming) {
        type = 'MOCK';
        typeLabel = 'Mock Test';
      } else {
        type = 'LIVE_EXAM';
        typeLabel = 'Live Exam';
      }

      // 3. Calculate Translation Coverage Breakdown
      const totalQuestions = exam.examQuestions?.length || 0;
      const coverageMap: Record<string, number> = {};
      let totalPercentageSum = 0;
      let configuredLanguagesCount = 0;

      // Use configured exam languages or top active platform languages
      const targetLanguages =
        exam.languages && exam.languages.length > 0
          ? exam.languages.map((el: any) => el.language)
          : allActiveLanguages.slice(0, 4);

      for (const lang of targetLanguages) {
        if (!lang) continue;
        const code = (lang.code || 'EN').toUpperCase();
        if (totalQuestions === 0) {
          coverageMap[code] = 0;
          continue;
        }

        const translatedCount = (exam.examQuestions || []).filter((eq: any) =>
          eq.question?.translations?.some((t: any) => t.languageId === lang.id),
        ).length;

        const pct = Math.round((translatedCount / totalQuestions) * 100);
        coverageMap[code] = pct;
        totalPercentageSum += pct;
        configuredLanguagesCount++;
      }

      const overallCoveragePercentage =
        configuredLanguagesCount > 0
          ? Math.round(totalPercentageSum / configuredLanguagesCount)
          : 0;

      const isAllRequiredComplete =
        configuredLanguagesCount > 0 &&
        Object.values(coverageMap).every((pct) => pct >= 100);

      // 4. Build Subjects Summary
      let subjectsSummary = 'All Subjects';
      if (distinctSubjects.length === 1) {
        subjectsSummary = distinctSubjects[0].name;
      } else if (distinctSubjects.length > 1) {
        subjectsSummary = distinctSubjects.map((s) => s.name).join(' + ');
      }

      const statusName = exam.status?.name || 'DRAFT';
      const isLocked = ['ACTIVE', 'PUBLISHED', 'COMPLETED'].includes(
        statusName.toUpperCase(),
      );

      return {
        id: exam.id,
        title: exam.title,
        type,
        typeLabel,
        subject:
          distinctSubjects.length === 1
            ? {
                id: distinctSubjects[0].id,
                name: distinctSubjects[0].name,
                code: distinctSubjects[0].code,
              }
            : null,
        subjectsSummary,
        totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
        status: statusName,
        createdAt: exam.createdAt.toISOString(), // Authoritative database timestamp
        updatedAt: exam.updatedAt.toISOString(),
        createdBy: exam.createdBy
          ? {
              id: exam.createdBy.id,
              name: exam.createdBy.student?.name || exam.createdBy.email || 'Admin',
              email: exam.createdBy.email,
            }
          : null,
        translationCoverage: coverageMap,
        languagesCount: configuredLanguagesCount,
        overallCoveragePercentage,
        isAllRequiredComplete,
        isLocked,
      };
    });

    // If query.type is filtered
    let filteredItems = items;
    if (query.type && query.type !== 'ALL') {
      filteredItems = items.filter((item) => item.type === query.type);
    }

    return {
      items: filteredItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}

