import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionBankService } from '../question-bank.service';
import {
  QuestionImportStatus,
  QuestionImportRowStatus,
  QuestionImportRowAction,
  QuestionDifficultyEnum,
  QuestionTypeEnum,
} from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import {
  QuestionImportFilterDto,
  UpdateImportRowDto,
  ImportFormatEnum,
} from '../dto/question-import.dto';
import { CreateQuestionDto } from '../dto/create-question.dto';
import { UpdateQuestionDto } from '../dto/update-question.dto';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_ROW_COUNT = 50000;

interface AcademicCache {
  languages: Map<string, { id: string; name: string; code: string | null }>;
  defaultLanguage: { id: string; name: string; code: string | null };
  subjects: Map<string, { id: string; name: string; examTargetId: string }>;
  chapters: Map<string, { id: string; name: string; subjectId: string }>; // key: subjectId + '::' + name.toLowerCase()
  topics: Map<string, { id: string; name: string; chapterId: string }>; // key: chapterId + '::' + name.toLowerCase()
  subTopics: Map<string, { id: string; name: string; topicId: string }>; // key: topicId + '::' + name.toLowerCase()
  existingQuestions: Map<string, { id: string; status: string }>;
}

@Injectable()
export class QuestionImportService {
  private readonly logger = new Logger(QuestionImportService.name);
  private readonly storageDir = path.resolve(
    process.cwd(),
    'storage',
    'question-imports',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionBankService: QuestionBankService,
  ) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Validate uploaded file metadata
   */
  validateFile(file: { originalname: string; size: number; mimetype?: string }) {
    if (!file) {
      throw new BadRequestException('No file provided for import.');
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Invalid file extension '${ext}'. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`,
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
      );
    }
  }

  /**
   * Create import session record and save file to storage
   */
  async createImportSession(
    file: { originalname: string; size: number; buffer: Buffer; mimetype?: string },
    userId: string,
  ) {
    this.validateFile(file);

    const ext = path.extname(file.originalname).toLowerCase();
    const storedFileName = `${Date.now()}_${path.basename(file.originalname)}`;
    const storagePath = path.join(this.storageDir, storedFileName);

    await fs.promises.writeFile(storagePath, file.buffer);

    const importSession = await this.prisma.questionImport.create({
      data: {
        fileName: file.originalname,
        fileType: ext.replace('.', '').toUpperCase(),
        storageKey: storagePath,
        fileSize: file.size,
        status: QuestionImportStatus.UPLOADED,
        createdById: userId,
      },
    });

    return importSession;
  }

  /**
   * Parse uploaded file (XLSX / CSV) and stage normalized rows
   */
  async parseAndValidateImport(importId: string): Promise<any> {
    const importRecord = await this.prisma.questionImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException(`Import session '${importId}' not found.`);
    }

    if (
      importRecord.status === QuestionImportStatus.PROCESSING ||
      importRecord.status === QuestionImportStatus.COMPLETED
    ) {
      return importRecord;
    }

    // Set status to PROCESSING
    await this.prisma.questionImport.update({
      where: { id: importId },
      data: {
        status: QuestionImportStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    try {
      if (!importRecord.storageKey || !fs.existsSync(importRecord.storageKey)) {
        throw new BadRequestException('Import file not found on server.');
      }

      const fileBuffer = await fs.promises.readFile(importRecord.storageKey);
      const rawRows = await this.parseFileToRows(
        fileBuffer,
        importRecord.fileName,
      );

      if (rawRows.length === 0) {
        throw new BadRequestException(
          'Spreadsheet contains no valid data rows.',
        );
      }

      if (rawRows.length > MAX_ROW_COUNT) {
        throw new BadRequestException(
          `Spreadsheet contains ${rawRows.length} rows, which exceeds the maximum limit of ${MAX_ROW_COUNT}.`,
        );
      }

      // 1. Build in-memory lookup cache to prevent N+1 queries during validation
      const cache = await this.buildAcademicCache();

      // Pre-pass: auto-create any missing chapters/topics in the database on the fly
      for (const raw of rawRows) {
        const norm = this.normalizeRawRow(raw);
        if (norm.subject) {
          let subject = cache.subjects.get(norm.subject.toLowerCase());
          if (!subject) {
            const normSub = norm.subject.toLowerCase();
            for (const [_, sub] of cache.subjects.entries()) {
              if (
                sub.name.toLowerCase().includes(normSub) ||
                normSub.includes(sub.name.toLowerCase())
              ) {
                subject = sub;
                break;
              }
            }
          }

          if (subject) {
            const chapterName = norm.chapter?.trim() || 'General';
            let chapter =
              cache.chapters.get(`${subject.id}::${chapterName.toLowerCase()}`) ||
              cache.chapters.get(chapterName.toLowerCase());

            if (!chapter || chapter.subjectId !== subject.id) {
              let dbChapter = await this.prisma.chapter.findFirst({
                where: {
                  subjectId: subject.id,
                  name: { equals: chapterName, mode: 'insensitive' },
                },
              });

              if (!dbChapter) {
                dbChapter = await this.prisma.chapter.create({
                  data: {
                    subjectId: subject.id,
                    name: chapterName,
                    displayOrder: (cache.chapters.size || 0) + 1,
                  },
                });
              }

              chapter = {
                id: dbChapter.id,
                name: dbChapter.name,
                subjectId: dbChapter.subjectId,
              };
              cache.chapters.set(`${subject.id}::${chapterName.toLowerCase()}`, chapter);
              cache.chapters.set(chapter.id.toLowerCase(), chapter);
              cache.chapters.set(chapterName.toLowerCase(), chapter);
            }

            if (norm.topic && chapter) {
              const topicName = norm.topic.trim();
              let topic = cache.topics.get(`${chapter.id}::${topicName.toLowerCase()}`);
              if (!topic) {
                let dbTopic = await this.prisma.topic.findFirst({
                  where: {
                    chapterId: chapter.id,
                    name: { equals: topicName, mode: 'insensitive' },
                  },
                });

                if (!dbTopic) {
                  dbTopic = await this.prisma.topic.create({
                    data: {
                      chapterId: chapter.id,
                      name: topicName,
                      displayOrder: (cache.topics.size || 0) + 1,
                    },
                  });
                }

                topic = {
                  id: dbTopic.id,
                  name: dbTopic.name,
                  chapterId: dbTopic.chapterId,
                };
                cache.topics.set(`${chapter.id}::${topicName.toLowerCase()}`, topic);
                cache.topics.set(topic.id.toLowerCase(), topic);
                cache.topics.set(topicName.toLowerCase(), topic);
              }
            }
          }
        }
      }

      // 2. Normalize and validate each row
      const seenQuestionTextsInFile = new Set<string>();
      const seenQuestionIdsInFile = new Set<string>();

      const processedRows: Array<{
        rowNumber: number;
        status: QuestionImportRowStatus;
        action: QuestionImportRowAction;
        targetQuestionId: string | null;
        rawData: any;
        normalizedData: any;
        dtoData: any;
        errors: string[];
        warnings: string[];
      }> = [];

      let validCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;
      let updateCount = 0;
      let createCount = 0;

      for (let i = 0; i < rawRows.length; i++) {
        const raw = rawRows[i];
        const rowNumber = i + 1;
        const normalized = this.normalizeRawRow(raw);

        const {
          status,
          action,
          targetQuestionId,
          dtoData,
          errors,
          warnings,
        } = this.validateAndBuildRowDto(
          normalized,
          cache,
          seenQuestionTextsInFile,
          seenQuestionIdsInFile,
          rowNumber,
        );

        if (status === QuestionImportRowStatus.VALID) {
          validCount++;
          createCount++;
        } else if (status === QuestionImportRowStatus.UPDATE_AVAILABLE) {
          validCount++;
          updateCount++;
        } else if (status === QuestionImportRowStatus.DUPLICATE) {
          duplicateCount++;
        } else {
          invalidCount++;
        }

        processedRows.push({
          rowNumber,
          status,
          action,
          targetQuestionId,
          rawData: raw,
          normalizedData: normalized,
          dtoData,
          errors,
          warnings,
        });
      }

      // 3. Clear any existing rows for this import and insert in batches of 500
      await this.prisma.questionImportRow.deleteMany({
        where: { importId },
      });

      const CHUNK_SIZE = 500;
      for (let i = 0; i < processedRows.length; i += CHUNK_SIZE) {
        const chunk = processedRows.slice(i, i + CHUNK_SIZE);
        await this.prisma.questionImportRow.createMany({
          data: chunk.map((r) => ({
            importId,
            rowNumber: r.rowNumber,
            status: r.status,
            action: r.action,
            targetQuestionId: r.targetQuestionId,
            rawData: r.rawData,
            normalizedData: r.normalizedData,
            dtoData: r.dtoData,
            errors: r.errors,
            warnings: r.warnings,
            importStatus: 'PENDING',
          })),
        });
      }

      // 4. Update import session stats
      const updated = await this.prisma.questionImport.update({
        where: { id: importId },
        data: {
          status: QuestionImportStatus.READY_TO_IMPORT,
          totalRows: rawRows.length,
          validRows: validCount,
          invalidRows: invalidCount,
          duplicateRows: duplicateCount,
          updateRows: updateCount,
          createRows: createCount,
          processedRows: rawRows.length,
        },
      });

      this.logger.log(
        `Import session ${importId} validated: ${rawRows.length} total, ${validCount} valid (${updateCount} updates, ${createCount} new), ${invalidCount} invalid, ${duplicateCount} duplicates.`,
      );

      return updated;
    } catch (err: any) {
      this.logger.error(
        `Failed validating import session ${importId}: ${err.message}`,
        err.stack,
      );
      await this.prisma.questionImport.update({
        where: { id: importId },
        data: {
          status: QuestionImportStatus.FAILED,
          errorSummary: err.message || 'Validation failed due to internal error',
        },
      });
      throw err;
    }
  }

  /**
   * Execute batch import for all VALID and UPDATE_AVAILABLE rows
   */
  async executeImport(importId: string, userId: string): Promise<any> {
    const importRecord = await this.prisma.questionImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException(`Import session '${importId}' not found.`);
    }

    if (importRecord.status === QuestionImportStatus.IMPORTING) {
      throw new BadRequestException('Import is currently in progress.');
    }

    if (importRecord.status === QuestionImportStatus.COMPLETED) {
      throw new BadRequestException('Import has already completed.');
    }

    // Set status to IMPORTING
    await this.prisma.questionImport.update({
      where: { id: importId },
      data: {
        status: QuestionImportStatus.IMPORTING,
      },
    });

    const candidateRows = await this.prisma.questionImportRow.findMany({
      where: {
        importId,
        status: {
          in: [
            QuestionImportRowStatus.VALID,
            QuestionImportRowStatus.UPDATE_AVAILABLE,
          ],
        },
      },
      orderBy: { rowNumber: 'asc' },
    });

    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    // Process rows sequentially or in controlled mini-batches
    for (const row of candidateRows) {
      try {
        const dto = row.dtoData as any;
        if (!dto) {
          throw new Error('Missing prepared question payload');
        }

        if (row.action === QuestionImportRowAction.UPDATE && row.targetQuestionId) {
          // Update existing question
          const updateDto: UpdateQuestionDto = {
            subjectId: dto.subjectId,
            chapterId: dto.chapterId,
            topicId: dto.topicId || undefined,
            subTopicId: dto.subTopicId || undefined,
            difficultyLevel: dto.difficultyLevel,
            type: dto.type,
            defaultLanguageId: dto.defaultLanguageId,
            marks: dto.marks,
            negativeMarks: dto.negativeMarks,
            passage: dto.passage || undefined,
            assertion: dto.assertion || undefined,
            reason: dto.reason || undefined,
            translations: dto.translations,
            options: dto.options,
            answer: dto.answer,
            explanation: dto.explanation,
          };

          const updatedQuestion = await this.questionBankService.updateQuestion(
            row.targetQuestionId,
            updateDto,
            userId,
            ['SUPER_ADMIN', 'ADMIN'],
          );

          await this.prisma.questionImportRow.update({
            where: { id: row.id },
            data: {
              importStatus: 'SUCCESS',
              resultQuestionId: updatedQuestion.id,
            },
          });
          updatedCount++;
        } else {
          // Create new question
          const createDto: CreateQuestionDto = {
            subjectId: dto.subjectId,
            chapterId: dto.chapterId,
            topicId: dto.topicId || undefined,
            subTopicId: dto.subTopicId || undefined,
            difficultyLevel: dto.difficultyLevel,
            type: dto.type,
            defaultLanguageId: dto.defaultLanguageId,
            marks: dto.marks,
            negativeMarks: dto.negativeMarks,
            passage: dto.passage || undefined,
            assertion: dto.assertion || undefined,
            reason: dto.reason || undefined,
            translations: dto.translations,
            options: dto.options,
            answer: dto.answer,
            explanation: dto.explanation,
          };

          const createdQuestion = await this.questionBankService.createQuestion(
            createDto,
            userId,
          );

          await this.prisma.questionImportRow.update({
            where: { id: row.id },
            data: {
              importStatus: 'SUCCESS',
              resultQuestionId: createdQuestion.id,
            },
          });
          createdCount++;
        }
      } catch (err: any) {
        this.logger.warn(
          `Row ${row.rowNumber} failed import execution: ${err.message}`,
        );
        failedCount++;
        await this.prisma.questionImportRow.update({
          where: { id: row.id },
          data: {
            importStatus: 'FAILED',
            importError: err.message || 'Unknown database write error',
          },
        });
      }
    }

    const finalStatus =
      failedCount > 0 && createdCount === 0 && updatedCount === 0
        ? QuestionImportStatus.FAILED
        : QuestionImportStatus.COMPLETED;

    const completed = await this.prisma.questionImport.update({
      where: { id: importId },
      data: {
        status: finalStatus,
        createdCount,
        updatedCount,
        failedCount,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Import ${importId} finished execution: ${createdCount} created, ${updatedCount} updated, ${failedCount} failed.`,
    );

    return completed;
  }

  /**
   * Cancel an import session
   */
  async cancelImportSession(importId: string) {
    const importRecord = await this.prisma.questionImport.findUnique({
      where: { id: importId },
    });
    if (!importRecord) {
      throw new NotFoundException(`Import session '${importId}' not found.`);
    }

    return this.prisma.questionImport.update({
      where: { id: importId },
      data: { status: QuestionImportStatus.CANCELLED },
    });
  }

  /**
   * Get single import session by ID with stats
   */
  async getImportSession(importId: string) {
    const importRecord = await this.prisma.questionImport.findUnique({
      where: { id: importId },
      include: {
        createdBy: {
          select: { id: true, email: true, phone: true },
        },
      },
    });

    if (!importRecord) {
      throw new NotFoundException(`Import session '${importId}' not found.`);
    }

    return importRecord;
  }

  /**
   * Get paginated staging rows for preview & error inspection
   */
  async getImportRows(importId: string, query: QuestionImportFilterDto) {
    const { status, search, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = { importId };

    if (status && status !== 'ALL') {
      where.status = status as QuestionImportRowStatus;
    }

    const [rows, total] = await Promise.all([
      this.prisma.questionImportRow.findMany({
        where,
        skip,
        take,
        orderBy: { rowNumber: 'asc' },
      }),
      this.prisma.questionImportRow.count({ where }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / take) || 1,
      },
    };
  }

  /**
   * Update an imported row manually in preview before confirmation
   */
  async updateImportRow(
    importId: string,
    rowId: string,
    dto: UpdateImportRowDto,
  ) {
    const row = await this.prisma.questionImportRow.findUnique({
      where: { id: rowId },
    });
    if (!row || row.importId !== importId) {
      throw new NotFoundException(`Import row '${rowId}' not found.`);
    }

    const raw = dto.rawData ? { ...(row.rawData as any), ...dto.rawData } : row.rawData;
    const normalized = this.normalizeRawRow(raw);
    const cache = await this.buildAcademicCache();

    const validationResult = this.validateAndBuildRowDto(
      normalized,
      cache,
      new Set(),
      new Set(),
      row.rowNumber,
    );

    const updatedRow = await this.prisma.questionImportRow.update({
      where: { id: rowId },
      data: {
        rawData: raw,
        normalizedData: normalized,
        status: validationResult.status,
        action: dto.action
          ? (dto.action as QuestionImportRowAction)
          : validationResult.action,
        targetQuestionId:
          dto.targetQuestionId !== undefined
            ? dto.targetQuestionId
            : validationResult.targetQuestionId,
        dtoData: validationResult.dtoData,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      },
    });

    // Recompute parent counters
    await this.recalculateImportCounters(importId);

    return updatedRow;
  }

  /**
   * Recalculate import summary counts after inline row corrections
   */
  private async recalculateImportCounters(importId: string) {
    const [
      total,
      valid,
      invalid,
      duplicate,
      updateAvailable,
    ] = await Promise.all([
      this.prisma.questionImportRow.count({ where: { importId } }),
      this.prisma.questionImportRow.count({
        where: { importId, status: QuestionImportRowStatus.VALID },
      }),
      this.prisma.questionImportRow.count({
        where: { importId, status: QuestionImportRowStatus.INVALID },
      }),
      this.prisma.questionImportRow.count({
        where: { importId, status: QuestionImportRowStatus.DUPLICATE },
      }),
      this.prisma.questionImportRow.count({
        where: { importId, status: QuestionImportRowStatus.UPDATE_AVAILABLE },
      }),
    ]);

    await this.prisma.questionImport.update({
      where: { id: importId },
      data: {
        totalRows: total,
        validRows: valid + updateAvailable,
        invalidRows: invalid,
        duplicateRows: duplicate,
        updateRows: updateAvailable,
        createRows: valid,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PARSING & NORMALIZATION ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Parse buffer into array of key-value objects
   */
  private async parseFileToRows(
    buffer: Buffer,
    fileName: string,
  ): Promise<Record<string, any>[]> {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const worksheet = workbook.worksheets[0];
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
            // Handle rich text or formula results if any
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

        // Add if row contains at least one non-empty value
        if (Object.values(rowData).some((v) => v !== '')) {
          rows.push(rowData);
        }
      });

      return rows;
    }

    // CSV parser
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
          i++; // skip escaped quote
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
    return values;
  }

  /**
   * Normalize raw column variations into standardized internal keys
   */
  private normalizeRawRow(raw: Record<string, any>): Record<string, any> {
    const get = (...keys: string[]): string => {
      for (const k of keys) {
        const direct = raw[k.toLowerCase()];
        if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
          return String(direct).trim();
        }
        // Check fuzzy key without underscores or spaces
        const strippedKey = k.toLowerCase().replace(/[_\s-]/g, '');
        for (const rawKey of Object.keys(raw)) {
          if (rawKey.replace(/[_\s-]/g, '').toLowerCase() === strippedKey) {
            const val = raw[rawKey];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              return String(val).trim();
            }
          }
        }
      }
      return '';
    };

    return {
      questionId: get('question_id', 'questionid', 'id', 'question_code'),
      subject: get('subject', 'subject_name', 'subject_id', 'subjectname'),
      chapter: get('chapter', 'chapter_name', 'chapter_id', 'chaptername'),
      topic: get('topic', 'topic_name', 'topic_id', 'topicname'),
      subTopic: get('sub_topic', 'subtopic', 'sub_topic_name', 'sub_topic_id'),
      difficulty: get('difficulty', 'difficulty_level', 'difficultyLevel', 'level'),
      questionType: get('question_type', 'type', 'questionType', 'format'),
      language: get('language', 'default_language', 'preferred_language', 'lang'),
      marks: get('marks', 'mark', 'marks_per_question', 'score'),
      negativeMarks: get('negative_marks', 'negativemarks', 'neg_marks', 'penalty'),
      questionText: get('question', 'question_text', 'questiontext', 'statement', 'text'),
      passage: get('passage', 'passage_text', 'passagetext', 'case', 'case_study'),
      assertion: get('assertion', 'assertion_text', 'assertiontext', 'assertion_statement'),
      reason: get('reason', 'reason_text', 'reasontext', 'reason_statement'),
      optionA: get('option_a', 'optiona', 'option a', 'opt_a', 'opta'),
      optionB: get('option_b', 'optionb', 'option b', 'opt_b', 'optb'),
      optionC: get('option_c', 'optionc', 'option c', 'opt_c', 'optc'),
      optionD: get('option_d', 'optiond', 'option d', 'opt_d', 'optd'),
      optionE: get('option_e', 'optione', 'option e', 'opt_e', 'opte'),
      optionF: get('option_f', 'optionf', 'option f', 'opt_f', 'optf'),
      correctAnswer: get('correct_answer', 'correctanswer', 'correct_option', 'answer', 'ans'),
      numericalAnswer: get('numerical_answer', 'numericalanswer', 'numerical_value', 'value'),
      numericalTolerance: get('numerical_tolerance', 'tolerance', 'margin'),
      numericalRangeStart: get('numerical_range_start', 'range_start', 'min_value'),
      numericalRangeEnd: get('numerical_range_end', 'range_end', 'max_value'),
      explanation: get('explanation', 'solution', 'explanation_text', 'derivation'),
    };
  }

  /**
   * Preload lookup cache for high-performance validation
   */
  private async buildAcademicCache(): Promise<AcademicCache> {
    const [languages, subjects, chapters, topics, subTopics, existingQuestions] =
      await Promise.all([
        this.prisma.preferredLanguage.findMany(),
        this.prisma.subject.findMany(),
        this.prisma.chapter.findMany(),
        this.prisma.topic.findMany(),
        this.prisma.subTopic.findMany(),
        this.prisma.question.findMany({
          select: { id: true, status: true },
        }),
      ]);

    const languageMap = new Map<string, { id: string; name: string; code: string | null }>();
    let defaultLang = languages.find(
      (l) => l.code === 'en' || l.name.toUpperCase() === 'ENGLISH' || l.isActive,
    ) || languages[0];

    for (const lang of languages) {
      languageMap.set(lang.id.toLowerCase(), lang);
      languageMap.set(lang.name.toLowerCase(), lang);
      if (lang.code) languageMap.set(lang.code.toLowerCase(), lang);
    }

    const subjectMap = new Map<string, { id: string; name: string; examTargetId: string }>();
    for (const sub of subjects) {
      subjectMap.set(sub.id.toLowerCase(), sub);
      subjectMap.set(sub.name.toLowerCase(), sub);
      if (sub.code) subjectMap.set(sub.code.toLowerCase(), sub);
    }

    const chapterMap = new Map<string, { id: string; name: string; subjectId: string }>();
    for (const ch of chapters) {
      chapterMap.set(ch.id.toLowerCase(), ch);
      chapterMap.set(`${ch.subjectId}::${ch.name.toLowerCase()}`, ch);
      chapterMap.set(ch.name.toLowerCase(), ch);
    }

    const topicMap = new Map<string, { id: string; name: string; chapterId: string }>();
    for (const top of topics) {
      topicMap.set(top.id.toLowerCase(), top);
      topicMap.set(`${top.chapterId}::${top.name.toLowerCase()}`, top);
      topicMap.set(top.name.toLowerCase(), top);
    }

    const subTopicMap = new Map<string, { id: string; name: string; topicId: string }>();
    for (const subTop of subTopics) {
      subTopicMap.set(subTop.id.toLowerCase(), subTop);
      subTopicMap.set(`${subTop.topicId}::${subTop.name.toLowerCase()}`, subTop);
      subTopicMap.set(subTop.name.toLowerCase(), subTop);
    }

    const questionMap = new Map<string, { id: string; status: string }>();
    for (const q of existingQuestions) {
      questionMap.set(q.id.toLowerCase(), q);
    }

    return {
      languages: languageMap,
      defaultLanguage: defaultLang,
      subjects: subjectMap,
      chapters: chapterMap,
      topics: topicMap,
      subTopics: subTopicMap,
      existingQuestions: questionMap,
    };
  }

  /**
   * Validate a single row and build its Create/Update Question DTO
   */
  private validateAndBuildRowDto(
    norm: Record<string, any>,
    cache: AcademicCache,
    seenQuestionTexts: Set<string>,
    seenQuestionIds: Set<string>,
    rowNumber: number,
  ): {
    status: QuestionImportRowStatus;
    action: QuestionImportRowAction;
    targetQuestionId: string | null;
    dtoData: any;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ─── 1. Check Target / Update ID ────────────────────────────
    let targetQuestionId: string | null = null;
    let action: QuestionImportRowAction = QuestionImportRowAction.CREATE;

    if (norm.questionId) {
      const qId = norm.questionId.toLowerCase();
      if (seenQuestionIds.has(qId)) {
        errors.push(`Duplicate question_id '${norm.questionId}' in uploaded file.`);
      } else {
        seenQuestionIds.add(qId);
      }

      const existing = cache.existingQuestions.get(qId);
      if (existing) {
        targetQuestionId = existing.id;
        action = QuestionImportRowAction.UPDATE;
      } else {
        errors.push(
          `Question ID '${norm.questionId}' does not exist in the database. Cannot update.`,
        );
      }
    }

    // ─── 2. Academic Hierarchy Resolution ───────────────────────
    let resolvedSubjectId = '';
    let resolvedChapterId = '';
    let resolvedTopicId: string | null = null;
    let resolvedSubTopicId: string | null = null;

    if (!norm.subject) {
      errors.push('Subject is required.');
    } else {
      let subject = cache.subjects.get(norm.subject.toLowerCase());
      if (!subject) {
        const normSub = norm.subject.toLowerCase();
        for (const [_, sub] of cache.subjects.entries()) {
          if (
            sub.name.toLowerCase().includes(normSub) ||
            normSub.includes(sub.name.toLowerCase())
          ) {
            subject = sub;
            break;
          }
        }
      }

      if (!subject) {
        errors.push(`Subject '${norm.subject}' not found in database.`);
      } else {
        resolvedSubjectId = subject.id;
      }
    }

    if (resolvedSubjectId) {
      const chapterName = norm.chapter?.trim() || 'General';
      const chapter =
        cache.chapters.get(`${resolvedSubjectId}::${chapterName.toLowerCase()}`) ||
        cache.chapters.get(chapterName.toLowerCase()) ||
        Array.from(cache.chapters.values()).find((c) => c.subjectId === resolvedSubjectId);

      if (chapter) {
        resolvedChapterId = chapter.id;
      }
    }

    if (norm.topic && resolvedChapterId) {
      const topicName = norm.topic.trim();
      const topic =
        cache.topics.get(`${resolvedChapterId}::${topicName.toLowerCase()}`) ||
        cache.topics.get(topicName.toLowerCase());

      if (topic) {
        resolvedTopicId = topic.id;
      }
    }

    if (norm.subTopic && resolvedTopicId) {
      const subTopic =
        cache.subTopics.get(`${resolvedTopicId}::${norm.subTopic.toLowerCase()}`) ||
        cache.subTopics.get(norm.subTopic.toLowerCase());

      if (subTopic) {
        resolvedSubTopicId = subTopic.id;
      }
    }

    // ─── 3. Language Resolution ─────────────────────────────────
    let resolvedLanguageId = cache.defaultLanguage?.id;
    if (norm.language) {
      const lang = cache.languages.get(norm.language.toLowerCase());
      if (lang) {
        resolvedLanguageId = lang.id;
      } else {
        warnings.push(
          `Language '${norm.language}' not recognized. Using default (${cache.defaultLanguage?.name}).`,
        );
      }
    }

    // ─── 4. Question Type & Difficulty ──────────────────────────
    let questionType: QuestionTypeEnum = QuestionTypeEnum.SINGLE_CORRECT;
    if (norm.questionType) {
      const formattedType = norm.questionType
        .toUpperCase()
        .replace(/[\s-]/g, '_');
      if (Object.values(QuestionTypeEnum).includes(formattedType as any)) {
        questionType = formattedType as QuestionTypeEnum;
      } else if (formattedType === 'MCQ' || formattedType === 'SINGLE') {
        questionType = QuestionTypeEnum.SINGLE_CORRECT;
      } else if (formattedType === 'MSQ' || formattedType === 'MULTIPLE') {
        questionType = QuestionTypeEnum.MULTIPLE_CORRECT;
      } else if (formattedType === 'NUM' || formattedType === 'INTEGER') {
        questionType = QuestionTypeEnum.NUMERICAL;
      } else if (
        formattedType === 'ASSERTION' ||
        formattedType === 'ASSERTION_AND_REASON'
      ) {
        questionType = QuestionTypeEnum.ASSERTION_REASON;
      } else if (formattedType === 'CASE' || formattedType === 'PASSAGE') {
        questionType = QuestionTypeEnum.CASE_BASED;
      } else {
        errors.push(
          `Invalid question type '${norm.questionType}'. Allowed: ${Object.values(QuestionTypeEnum).join(', ')}`,
        );
      }
    }

    let difficultyLevel: QuestionDifficultyEnum = QuestionDifficultyEnum.MEDIUM;
    if (norm.difficulty) {
      const formattedDiff = norm.difficulty
        .toUpperCase()
        .replace(/[\s-]/g, '_');
      if (
        Object.values(QuestionDifficultyEnum).includes(formattedDiff as any)
      ) {
        difficultyLevel = formattedDiff as QuestionDifficultyEnum;
      } else {
        warnings.push(
          `Difficulty '${norm.difficulty}' invalid. Defaulting to MEDIUM.`,
        );
      }
    }

    // ─── 5. Marks & Scoring ─────────────────────────────────────
    const marks =
      norm.marks !== '' && !isNaN(Number(norm.marks)) ? Number(norm.marks) : 4;
    const negativeMarks =
      norm.negativeMarks !== '' && !isNaN(Number(norm.negativeMarks))
        ? Number(norm.negativeMarks)
        : 1;

    if (marks < 0) errors.push('Marks must be non-negative.');
    if (negativeMarks < 0) errors.push('Negative marks must be non-negative.');

    // ─── 6. Question Text & Duplication Check ───────────────────
    if (!norm.questionText || !norm.questionText.trim()) {
      errors.push('Question statement is required.');
    } else {
      const normalizedKey = `${resolvedSubjectId}_${norm.questionText.trim().toLowerCase()}`;
      if (action === QuestionImportRowAction.CREATE) {
        if (seenQuestionTexts.has(normalizedKey)) {
          warnings.push('Duplicate question statement found in uploaded file.');
        } else {
          seenQuestionTexts.add(normalizedKey);
        }
      }
    }

    // ─── 7. Type-Specific Validation & Options Setup ───────────
    const options: Array<{
      optionKey: string;
      optionLabel: string;
      optionText: string;
      isCorrect: boolean;
      displayOrder: number;
    }> = [];

    const rawOptions = [
      { key: 'A', text: norm.optionA },
      { key: 'B', text: norm.optionB },
      { key: 'C', text: norm.optionC },
      { key: 'D', text: norm.optionD },
      { key: 'E', text: norm.optionE },
      { key: 'F', text: norm.optionF },
    ].filter((o) => Boolean(o.text && o.text.trim()));

    // Parse correct answers (e.g., 'A', 'B', 'A,C', 'Option A')
    const correctAnswers = (norm.correctAnswer || '')
      .toUpperCase()
      .split(/[,;&|]/)
      .map((s: string) =>
        s.replace(/OPTION/g, '').replace(/[^A-Z0-9.-]/g, '').trim(),
      )
      .filter(Boolean);

    let answerPayload: any = {
      answerType: questionType,
    };

    if (
      questionType === QuestionTypeEnum.SINGLE_CORRECT ||
      questionType === QuestionTypeEnum.MULTIPLE_CORRECT ||
      questionType === QuestionTypeEnum.ASSERTION_REASON ||
      questionType === QuestionTypeEnum.CASE_BASED
    ) {
      if (rawOptions.length < 2) {
        errors.push(
          `${questionType} question requires at least 2 options (e.g. Option A & Option B).`,
        );
      }

      rawOptions.forEach((opt, idx) => {
        const isCorrect =
          correctAnswers.includes(opt.key) ||
          correctAnswers.includes(opt.text.toUpperCase());

        options.push({
          optionKey: opt.key,
          optionLabel: opt.text,
          optionText: opt.text,
          isCorrect,
          displayOrder: idx,
        });
      });

      const correctCount = options.filter((o) => o.isCorrect).length;

      if (questionType === QuestionTypeEnum.SINGLE_CORRECT) {
        if (correctCount !== 1) {
          errors.push(
            `Single Correct MCQ must have exactly one correct option marked (Found ${correctCount} correct: '${correctAnswers.join(', ')}').`,
          );
        }
      } else if (questionType === QuestionTypeEnum.MULTIPLE_CORRECT) {
        if (correctCount < 1) {
          errors.push(
            'Multiple Correct MCQ must have at least one correct option marked.',
          );
        }
      } else if (questionType === QuestionTypeEnum.ASSERTION_REASON) {
        if (!norm.assertion || !norm.assertion.trim()) {
          errors.push('Assertion (A) statement is required.');
        }
        if (!norm.reason || !norm.reason.trim()) {
          errors.push('Reason (R) statement is required.');
        }
        if (correctCount < 1) {
          errors.push(
            'Assertion-Reason question must have a correct option selected.',
          );
        }
      } else if (questionType === QuestionTypeEnum.CASE_BASED) {
        if (!norm.passage || !norm.passage.trim()) {
          errors.push('Case-Based question requires a narrative passage.');
        }
        if (correctCount < 1) {
          errors.push('Case-Based question must have a correct option marked.');
        }
      }
    } else if (questionType === QuestionTypeEnum.NUMERICAL) {
      const hasDirect =
        norm.numericalAnswer !== '' && !isNaN(Number(norm.numericalAnswer));
      const hasRange =
        norm.numericalRangeStart !== '' &&
        norm.numericalRangeEnd !== '' &&
        !isNaN(Number(norm.numericalRangeStart)) &&
        !isNaN(Number(norm.numericalRangeEnd));

      if (!hasDirect && !hasRange) {
        errors.push(
          'Numerical question requires a valid numerical_answer value or a valid numerical_range_start & numerical_range_end.',
        );
      }

      answerPayload = {
        answerType: QuestionTypeEnum.NUMERICAL,
        numericalAnswer: hasDirect ? Number(norm.numericalAnswer) : null,
        numericalTolerance:
          norm.numericalTolerance !== '' && !isNaN(Number(norm.numericalTolerance))
            ? Number(norm.numericalTolerance)
            : 0,
        numericalRangeStart:
          norm.numericalRangeStart !== '' && !isNaN(Number(norm.numericalRangeStart))
            ? Number(norm.numericalRangeStart)
            : null,
        numericalRangeEnd:
          norm.numericalRangeEnd !== '' && !isNaN(Number(norm.numericalRangeEnd))
            ? Number(norm.numericalRangeEnd)
            : null,
      };
    }

    // ─── 8. Assemble Prepared DTO Payload ───────────────────────
    const dtoData = {
      subjectId: resolvedSubjectId,
      chapterId: resolvedChapterId,
      topicId: resolvedTopicId || undefined,
      subTopicId: resolvedSubTopicId || undefined,
      difficultyLevel,
      type: questionType,
      defaultLanguageId: resolvedLanguageId,
      marks,
      negativeMarks,
      passage: norm.passage || null,
      assertion: norm.assertion || null,
      reason: norm.reason || null,
      translations: [
        {
          languageId: resolvedLanguageId,
          questionText: norm.questionText || '',
          passageText: norm.passage || null,
          assertionText: norm.assertion || null,
          reasonText: norm.reason || null,
          explanation: norm.explanation || null,
        },
      ],
      options: options.length > 0 ? options : undefined,
      answer: answerPayload,
      explanation: norm.explanation
        ? { explanation: norm.explanation }
        : undefined,
    };

    // Determine final status
    let status: QuestionImportRowStatus = QuestionImportRowStatus.VALID;
    if (errors.length > 0) {
      status = QuestionImportRowStatus.INVALID;
    } else if (action === QuestionImportRowAction.UPDATE) {
      status = QuestionImportRowStatus.UPDATE_AVAILABLE;
    }

    return {
      status,
      action,
      targetQuestionId,
      dtoData,
      errors,
      warnings,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATE & ERROR REPORT GENERATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generate downloadable sample import template (.xlsx or .csv)
   */
  async generateTemplate(format: ImportFormatEnum = ImportFormatEnum.XLSX): Promise<{
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Question Import Template');

    // Define columns
    sheet.columns = [
      { header: 'question_id', key: 'question_id', width: 22 },
      { header: 'subject', key: 'subject', width: 18 },
      { header: 'chapter', key: 'chapter', width: 22 },
      { header: 'topic', key: 'topic', width: 18 },
      { header: 'sub_topic', key: 'sub_topic', width: 18 },
      { header: 'question_type', key: 'question_type', width: 18 },
      { header: 'difficulty', key: 'difficulty', width: 14 },
      { header: 'marks', key: 'marks', width: 10 },
      { header: 'negative_marks', key: 'negative_marks', width: 14 },
      { header: 'question_text', key: 'question_text', width: 45 },
      { header: 'option_a', key: 'option_a', width: 25 },
      { header: 'option_b', key: 'option_b', width: 25 },
      { header: 'option_c', key: 'option_c', width: 25 },
      { header: 'option_d', key: 'option_d', width: 25 },
      { header: 'correct_answer', key: 'correct_answer', width: 16 },
      { header: 'numerical_answer', key: 'numerical_answer', width: 18 },
      { header: 'numerical_tolerance', key: 'numerical_tolerance', width: 18 },
      { header: 'assertion', key: 'assertion', width: 30 },
      { header: 'reason', key: 'reason', width: 30 },
      { header: 'passage', key: 'passage', width: 35 },
      { header: 'explanation', key: 'explanation', width: 40 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }, // Indigo-600
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // Sample Row 1: Single MCQ
    sheet.addRow({
      question_id: '',
      subject: 'Physics',
      chapter: 'Electrostatics',
      topic: 'Coulombs Law',
      sub_topic: 'Forces between charges',
      question_type: 'SINGLE_CORRECT',
      difficulty: 'MEDIUM',
      marks: 4,
      negative_marks: 1,
      question_text: 'What is the SI unit of electric flux?',
      option_a: 'Volt-meter (V m)',
      option_b: 'Newton/Coulomb',
      option_c: 'Joule/meter',
      option_d: 'Farad/meter',
      correct_answer: 'A',
      explanation: 'Electric flux is phi = E . A = (V/m) * m^2 = V m.',
    });

    // Sample Row 2: Multiple Choice MCQ
    sheet.addRow({
      question_id: '',
      subject: 'Chemistry',
      chapter: 'Chemical Kinetics',
      topic: 'Rate Laws',
      sub_topic: 'First Order Reactions',
      question_type: 'MULTIPLE_CORRECT',
      difficulty: 'HARD',
      marks: 4,
      negative_marks: 1,
      question_text: 'Which of the following are true for a first-order chemical reaction?',
      option_a: 'Half-life is independent of initial concentration',
      option_b: 'Unit of rate constant is s^-1',
      option_c: 'Plot of ln[A] vs time is a straight line',
      option_d: 'Rate is independent of reactant concentration',
      correct_answer: 'A,B,C',
      explanation: 'For first order reactions: t_1/2 = 0.693/k, k in s^-1, and ln[A] vs t has slope -k.',
    });

    // Sample Row 3: Numerical Value Question
    sheet.addRow({
      question_id: '',
      subject: 'Mathematics',
      chapter: 'Limits and Derivatives',
      topic: 'Standard Limits',
      sub_topic: 'Trigonometric Limits',
      question_type: 'NUMERICAL',
      difficulty: 'EASY',
      marks: 4,
      negative_marks: 0,
      question_text: 'Evaluate limit as x approaches 0 for sin(5x)/x.',
      numerical_answer: 5,
      numerical_tolerance: 0,
      explanation: 'lim (x->0) sin(5x)/x = 5 * lim (x->0) sin(5x)/(5x) = 5 * 1 = 5.',
    });

    // Sample Row 4: Assertion - Reason Question
    sheet.addRow({
      question_id: '',
      subject: 'Biology',
      chapter: 'Cell: The Unit of Life',
      topic: 'Cell Organelles',
      sub_topic: 'Mitochondria',
      question_type: 'ASSERTION_REASON',
      difficulty: 'MEDIUM',
      marks: 4,
      negative_marks: 1,
      question_text: 'Select the correct relationship between Assertion (A) and Reason (R).',
      assertion: 'Mitochondria are known as the powerhouses of the eukaryotic cell.',
      reason: 'They produce cellular energy in the form of ATP through aerobic respiration.',
      option_a: 'Both (A) and (R) are true and (R) is the correct explanation of (A)',
      option_b: 'Both (A) and (R) are true but (R) is NOT the correct explanation of (A)',
      option_c: '(A) is true but (R) is false',
      option_d: '(A) is false but (R) is true',
      correct_answer: 'A',
      explanation: 'ATP synthesis via oxidative phosphorylation occurs inside mitochondria.',
    });

    // Sample Row 5: Existing Question Update Example
    sheet.addRow({
      question_id: '00000000-0000-0000-0000-000000000000',
      subject: 'Physics',
      chapter: 'Current Electricity',
      topic: 'Ohm Law',
      sub_topic: 'Resistivity',
      question_type: 'SINGLE_CORRECT',
      difficulty: 'EASY',
      marks: 4,
      negative_marks: 1,
      question_text: 'Updated statement for existing question: State the relation between Voltage and Current at constant temperature.',
      option_a: 'V is proportional to I',
      option_b: 'V is inversely proportional to I',
      option_c: 'V is independent of I',
      option_d: 'V is proportional to I squared',
      correct_answer: 'A',
      explanation: 'By Ohm law, V = I * R.',
    });

    if (format === ImportFormatEnum.CSV) {
      const buffer = await workbook.csv.writeBuffer();
      return {
        buffer: Buffer.from(buffer),
        fileName: 'question_import_template.csv',
        contentType: 'text/csv',
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      fileName: 'question_import_template.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * Generate downloadable Error Report for an import session (.xlsx or .csv)
   */
  async generateErrorReport(
    importId: string,
    format: ImportFormatEnum = ImportFormatEnum.XLSX,
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    const importRecord = await this.prisma.questionImport.findUnique({
      where: { id: importId },
    });
    if (!importRecord) {
      throw new NotFoundException(`Import session '${importId}' not found.`);
    }

    const errorRows = await this.prisma.questionImportRow.findMany({
      where: {
        importId,
        status: {
          in: [
            QuestionImportRowStatus.INVALID,
            QuestionImportRowStatus.DUPLICATE,
          ],
        },
      },
      orderBy: { rowNumber: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Import Error Report');

    sheet.columns = [
      { header: 'Row Number', key: 'rowNumber', width: 14 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Error Reasons', key: 'errors', width: 50 },
      { header: 'Warnings', key: 'warnings', width: 35 },
      { header: 'Subject', key: 'subject', width: 18 },
      { header: 'Chapter', key: 'chapter', width: 22 },
      { header: 'Question Statement', key: 'questionText', width: 45 },
      { header: 'Question ID', key: 'questionId', width: 25 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE11D48' }, // Rose-600
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 26;

    for (const r of errorRows) {
      const raw = (r.rawData || {}) as any;
      const errors = Array.isArray(r.errors) ? (r.errors as string[]).join('; ') : '';
      const warnings = Array.isArray(r.warnings) ? (r.warnings as string[]).join('; ') : '';

      sheet.addRow({
        rowNumber: r.rowNumber,
        status: r.status,
        errors,
        warnings,
        subject: raw.subject || '',
        chapter: raw.chapter || '',
        questionText: raw.question_text || raw.question || '',
        questionId: raw.question_id || '',
      });
    }

    if (format === ImportFormatEnum.CSV) {
      const buffer = await workbook.csv.writeBuffer();
      return {
        buffer: Buffer.from(buffer),
        fileName: `import_errors_${importId.slice(0, 8)}.csv`,
        contentType: 'text/csv',
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      fileName: `import_errors_${importId.slice(0, 8)}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
