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
import { ExamPaperParserService } from './exam-paper-parser.service';
import { ExamPaperValidatorService } from './exam-paper-validator.service';
import {
  ExamImportFormatEnum,
  ExamImportFilterDto,
  ExamPaperValidationResult,
} from '../dto/exam-manager.dto';
import { QuestionDifficultyEnum, QuestionTypeEnum } from '@prisma/client';

@Injectable()
export class ExamPaperImportService {
  private readonly logger = new Logger(ExamPaperImportService.name);
  private readonly storageDir = path.join(process.cwd(), 'uploads', 'exam-imports');

  constructor(
    private readonly prisma: PrismaService,
    private readonly parserService: ExamPaperParserService,
    private readonly validatorService: ExamPaperValidatorService,
  ) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Upload and process question paper file synchronously with transaction safety
   */
  async processQuestionPaperUpload(
    file: { originalname: string; size: number; buffer: Buffer },
    userId: string,
  ) {
    this.validateFile(file);

    const ext = path.extname(file.originalname).toLowerCase();
    const storedFileName = `${Date.now()}_${path.basename(file.originalname)}`;
    const storagePath = path.join(this.storageDir, storedFileName);

    await fs.promises.writeFile(storagePath, file.buffer);

    // 1. Create staged ExamImport session record
    const importSession = await (this.prisma as any).examImport.create({
      data: {
        fileName: file.originalname,
        fileType: ext.replace('.', '').toUpperCase(),
        storageKey: storagePath,
        fileSize: file.size,
        status: 'PROCESSING',
        createdById: userId,
        startedAt: new Date(),
      },
    });

    try {
      // 2. Parse File
      const parsedRows = await this.parserService.parseBuffer(
        file.buffer,
        file.originalname,
      );

      // 3. Validate File
      const validationResult = await this.validatorService.validatePaper(
        parsedRows,
      );

      // 4. Record Staged Rows
      const stagingData = validationResult.validatedRows.map((r) => ({
        importId: importSession.id,
        rowNumber: r.rowNumber,
        status: r.isValid ? 'VALID' : 'INVALID',
        examCode: r.data.examCode,
        examTitle: r.data.examName,
        subjectName: r.data.subject,
        sectionName: r.data.sectionName,
        questionNumber: r.data.questionNumber,
        rawData: r.data as any,
        normalizedData: r.data as any,
        dtoData: r.data as any,
        errors: r.errors,
        warnings: r.warnings,
      }));

      await (this.prisma as any).examImportRow.createMany({
        data: stagingData,
      });

      // 5. Check If Validation Failed -> Reject without committing exam data
      if (!validationResult.isValid || validationResult.errors.length > 0) {
        const errorSummary = `Question paper validation failed with ${validationResult.errors.length} error(s). No exam created.`;

        const failedSession = await (this.prisma as any).examImport.update({
          where: { id: importSession.id },
          data: {
            status: 'FAILED',
            totalRows: validationResult.totalRows,
            validRows: validationResult.validRows,
            invalidRows: validationResult.invalidRows,
            errorSummary,
            completedAt: new Date(),
          },
        });

        return {
          success: false,
          status: 'FAILED',
          importId: importSession.id,
          message: errorSummary,
          summary: {
            totalRows: validationResult.totalRows,
            validRows: validationResult.validRows,
            invalidRows: validationResult.invalidRows,
            errorsCount: validationResult.errors.length,
          },
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          session: failedSession,
        };
      }

      // 6. Execute Atomic Transaction creating Exam, Sections, Questions, Answers, Options
      const createdExam = await this.createExamFromPaper(
        validationResult,
        importSession.id,
        userId,
      );

      const completedSession = await (this.prisma as any).examImport.update({
        where: { id: importSession.id },
        data: {
          status: 'COMPLETED',
          totalRows: validationResult.totalRows,
          validRows: validationResult.validRows,
          invalidRows: 0,
          examCount: 1,
          questionsCreated: validationResult.totalQuestions,
          sectionsCreated: validationResult.sections.length,
          createdExamId: createdExam.id,
          createdExamCode: validationResult.examCode,
          createdExamTitle: createdExam.title,
          completedAt: new Date(),
        },
      });

      return {
        success: true,
        status: 'SUCCESS',
        importId: importSession.id,
        examId: createdExam.id,
        examTitle: createdExam.title,
        examCode: validationResult.examCode,
        message: `Exam '${createdExam.title}' created successfully with ${validationResult.totalQuestions} questions and ${validationResult.sections.length} sections!`,
        summary: {
          totalRows: validationResult.totalRows,
          questionsCreated: validationResult.totalQuestions,
          sectionsCreated: validationResult.sections.length,
          durationMinutes: validationResult.durationMinutes,
          totalMarks: validationResult.totalMarks,
        },
        errors: [],
        warnings: validationResult.warnings,
        session: completedSession,
      };
    } catch (err: any) {
      this.logger.error(`Import execution error: ${err.message}`, err.stack);

      await (this.prisma as any).examImport.update({
        where: { id: importSession.id },
        data: {
          status: 'FAILED',
          errorSummary: err.message || 'Import processing encountered a fatal error.',
          completedAt: new Date(),
        },
      });

      throw new BadRequestException(
        err.message || 'Failed to process question paper import.',
      );
    }
  }

  /**
   * Atomic creation of Exam, Sections, and Questions in a single database transaction
   */
  private async createExamFromPaper(
    validation: ExamPaperValidationResult,
    importId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve or create ExamTarget
      const targetName =
        validation.validatedRows[0]?.data.examTarget?.trim() || 'NEET';
      let examTarget = await tx.examTarget.findFirst({
        where: { name: { equals: targetName, mode: 'insensitive' } },
      });
      if (!examTarget) {
        examTarget = await tx.examTarget.findFirst();
        if (!examTarget) {
          examTarget = await tx.examTarget.create({
            data: { name: targetName, description: `${targetName} Target Exam` },
          });
        }
      }

      // 2. Resolve ExamStatus (PUBLISHED or DRAFT)
      let publishedStatus = await tx.examStatus.findFirst({
        where: { name: { in: ['PUBLISHED', 'ACTIVE', 'GENERATED'] } },
      });
      if (!publishedStatus) {
        publishedStatus = await tx.examStatus.create({
          data: { name: 'PUBLISHED' },
        });
      }

      // 3. Resolve Default PreferredLanguage
      let defaultLang = await tx.preferredLanguage.findFirst({
        where: { code: 'en' },
      });
      if (!defaultLang) {
        defaultLang = await tx.preferredLanguage.findFirst();
      }

      // 4. Create Exam Record
      const exam = await tx.exam.create({
        data: {
          examTargetId: examTarget.id,
          title: validation.examTitle,
          description:
            validation.validatedRows[0]?.data.examDescription ||
            `Imported from Question Paper (${validation.examCode})`,
          totalQuestions: validation.totalQuestions,
          totalMarks: validation.totalMarks,
          durationMinutes: validation.durationMinutes,
          defaultMarksPerQuestion: 4,
          defaultNegativeMarks: 1,
          statusId: publishedStatus.id,
          createdById: userId,
        },
      });

      // 5. Create ExamLanguage
      if (defaultLang) {
        await tx.examLanguage.create({
          data: {
            examId: exam.id,
            languageId: defaultLang.id,
            isDefault: true,
            displayOrder: 1,
          },
        });
      }

      // 6. Create ExamSections
      const sectionNameToDbRecord = new Map<string, any>();

      for (let sIdx = 0; sIdx < validation.sections.length; sIdx++) {
        const sec = validation.sections[sIdx];

        // Find or create Subject under exam target
        let subject = await tx.subject.findFirst({
          where: {
            examTargetId: examTarget.id,
            name: { equals: sec.subject, mode: 'insensitive' },
          },
        });

        if (!subject) {
          subject = await tx.subject.create({
            data: {
              examTargetId: examTarget.id,
              name: sec.subject,
              code: sec.subject.toUpperCase().slice(0, 4),
              displayOrder: sIdx + 1,
            },
          });
        }

        const examSection = await tx.examSection.create({
          data: {
            examId: exam.id,
            subjectId: subject.id,
            name: sec.name,
            totalQuestions: sec.questionCount,
            displayOrder: sIdx + 1,
          },
        });

        sectionNameToDbRecord.set(`${sec.subject}::${sec.name}`, {
          section: examSection,
          subject,
        });
      }

      // 7. Iterate through validated rows and create Questions, Options, Answers, Explanations & ExamQuestions
      for (let qIdx = 0; qIdx < validation.validatedRows.length; qIdx++) {
        const row = validation.validatedRows[qIdx];
        const data = row.data;

        const secKey = `${data.subject || 'General'}::${
          data.sectionName || `${data.subject || 'General'} Section`
        }`;
        const secData =
          sectionNameToDbRecord.get(secKey) ||
          Array.from(sectionNameToDbRecord.values())[0];

        const subject = secData.subject;
        const examSection = secData.section;

        // Resolve Chapter
        let chapter = data.chapter
          ? await tx.chapter.findFirst({
              where: {
                subjectId: subject.id,
                name: { equals: data.chapter, mode: 'insensitive' },
              },
            })
          : null;

        if (!chapter) {
          chapter = await tx.chapter.findFirst({
            where: { subjectId: subject.id },
          });
          if (!chapter) {
            chapter = await tx.chapter.create({
              data: {
                subjectId: subject.id,
                name: data.chapter || `${subject.name} General Chapter`,
              },
            });
          }
        }

        // Difficulty level
        const diffLevel = (
          ['EASY', 'MEDIUM', 'HARD', 'VERY_HARD'].includes(data.difficulty || '')
            ? data.difficulty
            : 'MEDIUM'
        ) as QuestionDifficultyEnum;

        // Question Type
        const qType = (
          [
            'SINGLE_CORRECT',
            'MULTIPLE_CORRECT',
            'NUMERICAL',
            'ASSERTION_REASON',
            'MATCH_FOLLOWING',
            'CASE_BASED',
          ].includes(data.questionType || '')
            ? data.questionType
            : 'SINGLE_CORRECT'
        ) as QuestionTypeEnum;

        // Create Question
        const question = await tx.question.create({
          data: {
            subjectId: subject.id,
            chapterId: chapter.id,
            difficultyLevel: diffLevel,
            type: qType,
            status: 'APPROVED',
            marks: data.marks || 4.0,
            negativeMarks: data.negativeMarks || 1.0,
            passage: data.passageText || null,
            assertion: data.assertionText || null,
            reason: data.reasonText || null,
            defaultLanguageId: defaultLang ? defaultLang.id : undefined as any,
            createdById: userId,
            approvedById: userId,
            approvedAt: new Date(),
          },
        });

        // Create English translation (or default language translation)
        if (defaultLang) {
          await tx.questionTranslation.create({
            data: {
              questionId: question.id,
              languageId: defaultLang.id,
              questionText: data.questionText,
              passageText: data.passageText || null,
              assertionText: data.assertionText || null,
              reasonText: data.reasonText || null,
              explanation: data.explanation || null,
            },
          });
        }

        // Create Options
        const optionKeys = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
        const correctAnswers = data.correctAnswer
          .toUpperCase()
          .split(/[\s,;]+/)
          .map((s) => s.trim());

        const createdOptionIds: string[] = [];
        const correctOptionIds: string[] = [];

        for (let oIdx = 0; oIdx < optionKeys.length; oIdx++) {
          const key = optionKeys[oIdx];
          const optText = (data as any)[`option${key}`];

          if (optText && optText.trim()) {
            const isCorrect = correctAnswers.includes(key);

            const opt = await tx.questionOption.create({
              data: {
                questionId: question.id,
                optionKey: key,
                optionText: optText.trim(),
                isCorrect,
                displayOrder: oIdx + 1,
              },
            });

            createdOptionIds.push(opt.id);
            if (isCorrect) correctOptionIds.push(opt.id);

            if (defaultLang) {
              await tx.questionOptionTranslation.create({
                data: {
                  optionId: opt.id,
                  languageId: defaultLang.id,
                  optionText: optText.trim(),
                },
              });
            }
          }
        }

        // Create QuestionAnswer
        await tx.questionAnswer.create({
          data: {
            questionId: question.id,
            answerType: qType,
            correctOptionIds: correctOptionIds.length > 0 ? correctOptionIds : null,
            numericalAnswer:
              qType === 'NUMERICAL' ? parseFloat(data.correctAnswer) : null,
          },
        });

        // Create QuestionExplanation if present
        if (data.explanation && data.explanation.trim()) {
          await tx.questionExplanation.create({
            data: {
              questionId: question.id,
              explanation: data.explanation.trim(),
            },
          });
        }

        // Create ExamQuestion link
        await tx.examQuestion.create({
          data: {
            examId: exam.id,
            sectionId: examSection.id,
            questionId: question.id,
            displayOrder: qIdx + 1,
            marks: data.marks || 4.0,
            negativeMarks: data.negativeMarks || 1.0,
          },
        });

        // Update staging row with success result
        await (tx as any).examImportRow.updateMany({
          where: {
            importId,
            rowNumber: row.rowNumber,
          },
          data: {
            importStatus: 'SUCCESS',
            resultQuestionId: question.id,
            resultExamId: exam.id,
          },
        });
      }

      return exam;
    });
  }

  /**
   * Get single import session status
   */
  async getImportSession(importId: string) {
    const session = await (this.prisma as any).examImport.findUnique({
      where: { id: importId },
      include: {
        createdBy: {
          select: { id: true, email: true, mobileNumber: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Exam import session '${importId}' not found.`);
    }

    return session;
  }

  /**
   * Get paginated staging rows for an import session
   */
  async getImportRows(importId: string, query: ExamImportFilterDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { importId };
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).examImportRow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { rowNumber: 'asc' },
      }),
      (this.prisma as any).examImportRow.count({ where }),
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
   * Get list of historical exam paper imports
   */
  async getImportHistory(query: ExamImportFilterDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).examImport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            select: { id: true, email: true, mobileNumber: true },
          },
        },
      }),
      (this.prisma as any).examImport.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Generate downloadable Question Paper Template (XLSX or CSV)
   */
  async generateTemplate(format: ExamImportFormatEnum) {
    const headers = [
      'exam_code',
      'exam_name',
      'exam_description',
      'exam_target',
      'duration_minutes',
      'subject',
      'section_name',
      'chapter',
      'topic',
      'question_number',
      'question_type',
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
      'correct_answer',
      'marks',
      'negative_marks',
      'difficulty',
      'explanation',
      'language',
    ];

    const sampleRows = [
      {
        exam_code: 'NEET-2026-MOCK-01',
        exam_name: 'NEET All India Full Mock Test 01',
        exam_description: 'Full syllabus mock test for Physics, Chemistry, and Biology',
        exam_target: 'NEET',
        duration_minutes: 200,
        subject: 'Physics',
        section_name: 'Physics - Section A',
        chapter: 'Laws of Motion',
        topic: "Newton's Second Law",
        question_number: 1,
        question_type: 'SINGLE_CORRECT',
        question_text:
          'A body of mass 5 kg is accelerated uniformly from rest to a speed of 20 m/s in 4 seconds. What is the net external force acting on the body?',
        passage_text: '',
        assertion_text: '',
        reason_text: '',
        option_a: '15 N',
        option_b: '25 N',
        option_c: '35 N',
        option_d: '45 N',
        option_e: '',
        option_f: '',
        correct_answer: 'B',
        marks: 4.0,
        negative_marks: 1.0,
        difficulty: 'MEDIUM',
        explanation: 'Acceleration a = (20 - 0)/4 = 5 m/s^2. Force F = m * a = 5 * 5 = 25 N.',
        language: 'en',
      },
      {
        exam_code: 'NEET-2026-MOCK-01',
        exam_name: 'NEET All India Full Mock Test 01',
        exam_description: 'Full syllabus mock test for Physics, Chemistry, and Biology',
        exam_target: 'NEET',
        duration_minutes: 200,
        subject: 'Chemistry',
        section_name: 'Chemistry - Section A',
        chapter: 'Chemical Bonding',
        topic: 'Hybridisation',
        question_number: 2,
        question_type: 'SINGLE_CORRECT',
        question_text:
          'Which of the following molecules has a linear geometry according to VSEPR theory?',
        passage_text: '',
        assertion_text: '',
        reason_text: '',
        option_a: 'H2O',
        option_b: 'SO2',
        option_c: 'BeCl2',
        option_d: 'NH3',
        option_e: '',
        option_f: '',
        correct_answer: 'C',
        marks: 4.0,
        negative_marks: 1.0,
        difficulty: 'EASY',
        explanation: 'BeCl2 has 2 bond pairs and 0 lone pairs on central atom Be, giving linear geometry (sp hybridization).',
        language: 'en',
      },
      {
        exam_code: 'NEET-2026-MOCK-01',
        exam_name: 'NEET All India Full Mock Test 01',
        exam_description: 'Full syllabus mock test for Physics, Chemistry, and Biology',
        exam_target: 'NEET',
        duration_minutes: 200,
        subject: 'Biology',
        section_name: 'Biology - Section A',
        chapter: 'Cell: The Unit of Life',
        topic: 'Mitochondria',
        question_number: 3,
        question_type: 'ASSERTION_REASON',
        question_text:
          'Assertion (A): Mitochondria are known as the powerhouses of the cell.\nReason (R): ATP is synthesized inside mitochondria via oxidative phosphorylation.',
        passage_text: '',
        assertion_text: 'Mitochondria are known as the powerhouses of the cell.',
        reason_text: 'ATP is synthesized inside mitochondria via oxidative phosphorylation.',
        option_a: 'Both (A) and (R) are true and (R) is the correct explanation of (A)',
        option_b: 'Both (A) and (R) are true but (R) is NOT the correct explanation of (A)',
        option_c: '(A) is true but (R) is false',
        option_d: '(A) is false but (R) is true',
        option_e: '',
        option_f: '',
        correct_answer: 'A',
        marks: 4.0,
        negative_marks: 1.0,
        difficulty: 'MEDIUM',
        explanation: 'Mitochondria produce cellular energy in the form of ATP through oxidative phosphorylation.',
        language: 'en',
      },
    ];

    if (format === ExamImportFormatEnum.CSV) {
      const csvLines = [headers.join(',')];
      for (const r of sampleRows) {
        const line = headers
          .map((h) => {
            const val = (r as any)[h] ?? '';
            return `"${String(val).replace(/"/g, '""')}"`;
          })
          .join(',');
        csvLines.push(line);
      }

      return {
        buffer: Buffer.from(csvLines.join('\n'), 'utf-8'),
        fileName: 'question_paper_import_template.csv',
        contentType: 'text/csv',
      };
    }

    // XLSX format
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('QuestionPaper');

    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h,
      width: h.includes('text') || h.includes('explanation') ? 45 : 20,
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4338CA' },
    };

    for (const r of sampleRows) {
      worksheet.addRow(r);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: 'question_paper_import_template.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * Generate downloadable Error Report (.xlsx or .csv) for failed import
   */
  async generateErrorReport(importId: string, format: ExamImportFormatEnum) {
    const session = await this.getImportSession(importId);
    const rows = await (this.prisma as any).examImportRow.findMany({
      where: { importId, status: 'INVALID' },
      orderBy: { rowNumber: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Errors');

    worksheet.columns = [
      { header: 'Row Number', key: 'rowNumber', width: 14 },
      { header: 'Subject', key: 'subject', width: 20 },
      { header: 'Section', key: 'section', width: 22 },
      { header: 'Question Text', key: 'questionText', width: 45 },
      { header: 'Validation Errors', key: 'errors', width: 60 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE11D48' },
    };

    for (const r of rows) {
      const errorsList = Array.isArray(r.errors)
        ? r.errors.join('; ')
        : String(r.errors || 'Validation error');

      worksheet.addRow({
        rowNumber: r.rowNumber,
        subject: r.subjectName || (r.rawData as any)?.subject || '',
        section: r.sectionName || (r.rawData as any)?.section_name || '',
        questionText: (r.rawData as any)?.question_text || '',
        errors: errorsList,
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `question_paper_errors_${importId.slice(0, 8)}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private validateFile(file: { originalname: string; size: number }) {
    if (!file) {
      throw new BadRequestException('No file provided for question paper upload.');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      throw new BadRequestException(
        `Invalid file type '${ext}'. Please upload a .csv, .xlsx, or .xls spreadsheet.`,
      );
    }

    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed limit of 25MB.`,
      );
    }
  }
}
