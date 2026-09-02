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
  BlueprintItemDto,
  BlueprintSubjectRule,
  ComprehensiveExamValidationResult,
  CreateExamFromUploadDto,
  ExamManagerFilterDto,
  TranslationValidationSummary,
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
            correctOptionIds:
              correctOptionIds.length > 0 ? correctOptionIds : undefined,
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

  /**
   * 1. Get all active predefined & custom blueprints from master data
   * GET /admin/exam-manager/blueprints
   */
  async getActiveBlueprints(): Promise<BlueprintItemDto[]> {
    const dbBlueprints = await this.prisma.examBlueprint.findMany({
      where: { isActive: true },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            durationMinutes: true,
            examTargetId: true,
            examTarget: { select: { id: true, name: true } },
          },
        },
        rules: {
          include: {
            subject: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: BlueprintItemDto[] = [];
    const seenNames = new Set<string>();

    for (const bp of dbBlueprints) {
      const subjectDist: BlueprintSubjectRule[] = [];
      if (bp.rules && bp.rules.length > 0) {
        for (const r of bp.rules) {
          if (r.subject?.name) {
            subjectDist.push({
              subject: r.subject.name,
              questionCount:
                r.selectionCount ||
                Math.round(
                  (bp.totalQuestions * (r.selectionPercentage || 0)) / 100,
                ) ||
                1,
            });
          }
        }
      }

      const name = bp.name || bp.exam?.title || 'Custom Blueprint';
      seenNames.add(name.toUpperCase());

      results.push({
        id: bp.id,
        name,
        code: (bp.name || 'BP')
          .toUpperCase()
          .replace(/\s+/g, '_')
          .slice(0, 10),
        description: `Predefined ${name} blueprint with ${bp.totalQuestions} questions`,
        totalQuestions: bp.totalQuestions,
        durationMinutes:
          bp.exam?.durationMinutes ||
          (bp.totalQuestions >= 180
            ? 200
            : bp.totalQuestions >= 75
              ? 180
              : 120),
        status: 'ACTIVE',
        subjectDistribution:
          subjectDist.length > 0
            ? subjectDist
            : [
                {
                  subject: 'Physics',
                  questionCount: Math.floor(bp.totalQuestions / 3),
                },
                {
                  subject: 'Chemistry',
                  questionCount: Math.floor(bp.totalQuestions / 3),
                },
                {
                  subject: 'Biology',
                  questionCount:
                    bp.totalQuestions -
                    2 * Math.floor(bp.totalQuestions / 3),
                },
              ],
        examTargetId: bp.exam?.examTargetId,
      });
    }

    // Ensure canonical predefined exam blueprints exist (NEET, JEE Main, CAT)
    const canonicals = [
      {
        name: 'NEET',
        code: 'NEET_UG',
        totalQuestions: 180,
        durationMinutes: 200,
        description:
          'Standard NTA NEET-UG blueprint (Physics 45, Chemistry 45, Biology 90 = 180 Questions)',
        subjectDistribution: [
          { subject: 'Physics', questionCount: 45 },
          { subject: 'Chemistry', questionCount: 45 },
          { subject: 'Biology', questionCount: 90 },
        ],
      },
      {
        name: 'JEE Main',
        code: 'JEE_MAIN',
        totalQuestions: 90,
        durationMinutes: 180,
        description:
          'Standard NTA JEE Main blueprint (Physics 30, Chemistry 30, Mathematics 30 = 90 Questions)',
        subjectDistribution: [
          { subject: 'Physics', questionCount: 30 },
          { subject: 'Chemistry', questionCount: 30 },
          { subject: 'Mathematics', questionCount: 30 },
        ],
      },
      {
        name: 'CAT',
        code: 'CAT',
        totalQuestions: 68,
        durationMinutes: 120,
        description:
          'Standard IIM CAT blueprint (VARC 24, DILR 20, Quantitative Aptitude 24 = 68 Questions)',
        subjectDistribution: [
          {
            subject: 'Verbal Ability & Reading Comprehension',
            questionCount: 24,
          },
          {
            subject: 'Data Interpretation & Logical Reasoning',
            questionCount: 20,
          },
          { subject: 'Quantitative Aptitude', questionCount: 24 },
        ],
      },
    ];

    for (const c of canonicals) {
      if (
        !seenNames.has(c.name.toUpperCase()) &&
        !seenNames.has(c.code.toUpperCase())
      ) {
        const target = await this.prisma.examTarget.findFirst({
          where: {
            OR: [
              { name: { contains: c.name, mode: 'insensitive' } },
              { name: { contains: c.code, mode: 'insensitive' } },
            ],
          },
        });

        results.unshift({
          id: `canonical_${c.code.toLowerCase()}`,
          name: c.name,
          code: c.code,
          description: c.description,
          totalQuestions: c.totalQuestions,
          durationMinutes: c.durationMinutes,
          status: 'ACTIVE',
          subjectDistribution: c.subjectDistribution,
          examTargetId: target?.id,
        });
      }
    }

    return results;
  }

  /**
   * Helper to parse translation spreadsheet rows
   */
  async parseTranslationBuffer(
    buffer: Buffer,
    fileName: string,
  ): Promise<any[]> {
    const workbook = new ExcelJS.Workbook();
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.csv') {
      const text = buffer.toString('utf-8');
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length <= 1) return [];

      const headers = lines[0]
        .split(',')
        .map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
      const rows: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]
          .split(',')
          .map((c) => c.replace(/^["']|["']$/g, '').trim());
        const rowObj: any = { rowNumber: i + 1 };
        headers.forEach((h, idx) => {
          rowObj[h] = cols[idx] || '';
        });
        rows.push(rowObj);
      }
      return rows;
    } else {
      await workbook.xlsx.load(buffer as any);
      const sheet = workbook.worksheets[0];
      if (!sheet) return [];

      const headers: string[] = [];
      sheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber] = String(cell.value || '')
          .trim()
          .toLowerCase();
      });

      const rows: any[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rowObj: any = { rowNumber };
        row.eachCell((cell, colNumber) => {
          const h = headers[colNumber];
          if (h) rowObj[h] = String(cell.value || '').trim();
        });
        rows.push(rowObj);
      });
      return rows;
    }
  }

  /**
   * 2. Validate Question Paper + Multiple Regional Translation Files against Blueprint
   * POST /admin/exam-manager/validate
   */
  async validateQuestionPaperAndTranslations(
    questionFile: { originalname: string; size: number; buffer: Buffer },
    blueprintId: string,
    translationFiles: Array<{
      file: { originalname: string; size: number; buffer: Buffer };
      languageId: string;
    }> = [],
  ): Promise<ComprehensiveExamValidationResult> {
    this.validateFile(questionFile);

    // 1. Resolve Blueprint rules
    const allBlueprints = await this.getActiveBlueprints();
    const blueprint = allBlueprints.find(
      (b) => b.id === blueprintId || b.code === blueprintId,
    );

    if (!blueprint) {
      throw new BadRequestException(
        `Selected blueprint '${blueprintId}' is invalid or inactive.`,
      );
    }

    // 2. Parse Question Paper File
    const parsedRows = await this.parserService.parseBuffer(
      questionFile.buffer,
      questionFile.originalname,
    );

    // 3. Validate Question Paper Structure
    const paperValidation =
      await this.validatorService.validatePaper(parsedRows);

    // 4. Validate Against Selected Blueprint Requirements
    const subjectCounts: Record<string, number> = {};
    for (const r of paperValidation.validatedRows) {
      if (r.isValid) {
        const sub = (r.data.subject || 'General').trim();
        let matchedSub = sub;
        if (/physic/i.test(sub)) matchedSub = 'Physics';
        else if (/chem/i.test(sub)) matchedSub = 'Chemistry';
        else if (/math/i.test(sub)) matchedSub = 'Mathematics';
        else if (/bio|botan|zool/i.test(sub)) matchedSub = 'Biology';

        subjectCounts[matchedSub] = (subjectCounts[matchedSub] || 0) + 1;
      }
    }

    const subjectChecks: Array<{
      subject: string;
      expectedCount: number;
      actualCount: number;
      isMatched: boolean;
    }> = [];

    let isBlueprintMatched = true;

    for (const rule of blueprint.subjectDistribution) {
      const actual = subjectCounts[rule.subject] || 0;
      const isMatched = actual === rule.questionCount;
      if (!isMatched) isBlueprintMatched = false;

      subjectChecks.push({
        subject: rule.subject,
        expectedCount: rule.questionCount,
        actualCount: actual,
        isMatched,
      });
    }

    const errors = [...paperValidation.errors];
    const warnings = [...paperValidation.warnings];

    if (!isBlueprintMatched) {
      for (const sc of subjectChecks) {
        if (!sc.isMatched) {
          const detail =
            sc.actualCount < sc.expectedCount
              ? `insufficient questions (${sc.actualCount}/${sc.expectedCount})`
              : `excess questions (${sc.actualCount}/${sc.expectedCount})`;
          errors.push({
            row: 0,
            column: 'subject_distribution',
            message: `Blueprint validation failed for ${sc.subject}: Required exactly ${sc.expectedCount} questions, found ${sc.actualCount} (${detail}).`,
          });
        }
      }
    }

    if (blueprint.totalQuestions && paperValidation.validRows !== blueprint.totalQuestions) {
      errors.push({
        row: 0,
        column: 'total_questions',
        message: `Blueprint total question count mismatch: Required ${blueprint.totalQuestions} questions, but paper contains ${paperValidation.validRows} valid questions.`,
      });
    }

    // 5. Validate Simultaneous Translation Files
    const allLanguages = await this.prisma.preferredLanguage.findMany();
    const langMap = new Map(allLanguages.map((l) => [l.id, l]));
    const translationsSummary: TranslationValidationSummary[] = [];

    for (const tf of translationFiles) {
      const lang = langMap.get(tf.languageId);
      if (!lang) {
        continue;
      }

      const tRows = await this.parseTranslationBuffer(
        tf.file.buffer,
        tf.file.originalname,
      );
      const totalQ = paperValidation.totalRows;
      let validRows = 0;
      let invalidRows = 0;
      const tErrors: string[] = [];

      for (const tr of tRows) {
        const qText = tr.question_text || tr.question || tr.text || '';
        if (!qText.trim()) {
          invalidRows++;
          tErrors.push(`Row ${tr.rowNumber}: Translated question text is missing.`);
        } else {
          validRows++;
        }
      }

      const coveragePercentage =
        totalQ > 0 ? Math.min(100, Math.round((validRows / totalQ) * 100)) : 0;

      translationsSummary.push({
        languageId: lang.id,
        languageCode: lang.code || lang.name,
        languageName: lang.name,
        fileName: tf.file.originalname,
        totalQuestions: totalQ,
        translatedQuestions: validRows,
        coveragePercentage,
        validRows,
        invalidRows,
        errors: tErrors.slice(0, 10),
      });
    }

    // 6. Build Preview Sample Rows
    const previewRows = paperValidation.validatedRows.slice(0, 15).map((r) => ({
      rowNumber: r.rowNumber,
      questionNumber: r.data.questionNumber,
      subject: r.data.subject,
      chapter: r.data.chapter,
      questionText: r.data.questionText,
      questionType: r.data.questionType || 'SINGLE_CORRECT',
      options: [
        { key: 'A', text: r.data.optionA || '', isCorrect: r.data.correctAnswer === 'A' },
        { key: 'B', text: r.data.optionB || '', isCorrect: r.data.correctAnswer === 'B' },
        { key: 'C', text: r.data.optionC || '', isCorrect: r.data.correctAnswer === 'C' },
        { key: 'D', text: r.data.optionD || '', isCorrect: r.data.correctAnswer === 'D' },
      ],
      correctAnswer: r.data.correctAnswer,
      difficulty: r.data.difficulty || 'MEDIUM',
      status: r.isValid ? ('VALID' as const) : ('INVALID' as const),
      errors: r.errors,
    }));

    const isValid = paperValidation.isValid && isBlueprintMatched && errors.length === 0;

    return {
      isValid,
      blueprint: {
        id: blueprint.id,
        name: blueprint.name,
        totalQuestions: blueprint.totalQuestions,
        isMatched: isBlueprintMatched,
        subjectChecks,
      },
      questionsSummary: {
        totalRows: paperValidation.totalRows,
        validRows: paperValidation.validRows,
        invalidRows: paperValidation.invalidRows,
        duplicateRows: 0,
        totalQuestions: paperValidation.totalQuestions,
        totalMarks: paperValidation.totalMarks,
        durationMinutes: paperValidation.durationMinutes || blueprint.durationMinutes,
        subjectCounts,
      },
      translationsSummary,
      previewRows,
      errors,
      warnings,
    };
  }

  /**
   * 3. Transactionally Create Draft Exam + Sections + Questions + Immutable Snapshot + Translations
   * POST /admin/exam-manager/create-from-upload
   */
  async createExamFromValidatedUpload(
    dto: CreateExamFromUploadDto,
    questionFile: { originalname: string; size: number; buffer: Buffer },
    translationFiles: Array<{
      file: { originalname: string; size: number; buffer: Buffer };
      languageId: string;
    }> = [],
    userId: string,
  ) {
    const validation = await this.validateQuestionPaperAndTranslations(
      questionFile,
      dto.blueprintId,
      translationFiles,
    );

    if (!validation.isValid && validation.errors.length > 0) {
      throw new BadRequestException(
        `Cannot create exam: ${validation.errors[0]?.message || 'Validation failed'}`,
      );
    }

    const parsedRows = await this.parserService.parseBuffer(
      questionFile.buffer,
      questionFile.originalname,
    );
    const paperValidation =
      await this.validatorService.validatePaper(parsedRows);

    // Resolve Exam Target & Status
    const allBlueprints = await this.getActiveBlueprints();
    const blueprint = allBlueprints.find(
      (b) => b.id === dto.blueprintId || b.code === dto.blueprintId,
    );

    let targetId = blueprint?.examTargetId;
    if (!targetId) {
      const defaultTarget = await this.prisma.examTarget.findFirst({
        orderBy: { createdAt: 'asc' },
      });
      targetId = defaultTarget?.id || '';
    }

    const draftStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'DRAFT' },
    });
    if (!draftStatus) {
      throw new NotFoundException('Exam status DRAFT not found.');
    }

    const marksPerQ = dto.defaultMarksPerQuestion || 4;
    const negMarks = dto.defaultNegativeMarks || 1;
    const duration =
      dto.durationMinutes ||
      blueprint?.durationMinutes ||
      validation.questionsSummary.durationMinutes ||
      180;
    const totalMarks =
      validation.questionsSummary.totalMarks ||
      validation.questionsSummary.totalQuestions * marksPerQ;

    // Parse Translation Rows ahead of transaction
    const parsedTranslationsMap: Record<string, any[]> = {};
    for (const tf of translationFiles) {
      const rows = await this.parseTranslationBuffer(
        tf.file.buffer,
        tf.file.originalname,
      );
      parsedTranslationsMap[tf.languageId] = rows;
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Exam
      const exam = await tx.exam.create({
        data: {
          examTargetId: targetId!,
          title: dto.title.trim(),
          description:
            dto.description ||
            `Exam created via Question Paper upload based on ${blueprint?.name || 'Blueprint'} (${paperValidation.totalQuestions} Questions)`,
          totalQuestions: paperValidation.totalQuestions,
          totalMarks,
          durationMinutes: duration,
          defaultMarksPerQuestion: marksPerQ,
          defaultNegativeMarks: negMarks,
          statusId: draftStatus.id,
          createdById: userId,
        },
      });

      // 2. Group Questions by Section / Subject
      const sectionsMap = new Map<string, typeof paperValidation.validatedRows>();
      for (const row of paperValidation.validatedRows) {
        if (!row.isValid) continue;
        const sName = row.data.sectionName || row.data.subject || 'General';
        if (!sectionsMap.has(sName)) sectionsMap.set(sName, []);
        sectionsMap.get(sName)!.push(row);
      }

      // 3. Create Sections and ExamQuestions
      let secOrder = 1;
      let globalQOrder = 1;
      const createdQuestionTuples: Array<{
        questionId: string;
        sourceRow: any;
        options: any[];
      }> = [];

      for (const [secName, secRows] of sectionsMap.entries()) {
        const firstRow = secRows[0];
        let subjectRecord = await tx.subject.findFirst({
          where: {
            OR: [
              { name: { contains: firstRow.data.subject, mode: 'insensitive' } },
              { code: { contains: firstRow.data.subject, mode: 'insensitive' } },
            ],
          },
        });
        if (!subjectRecord) {
          subjectRecord = await tx.subject.findFirst();
        }
        const subId = subjectRecord?.id || '';

        let chapterRecord = await tx.chapter.findFirst({
          where: { subjectId: subId },
        });
        if (!chapterRecord) {
          chapterRecord = await tx.chapter.findFirst();
        }
        const chapId = chapterRecord?.id || '';

        const defaultLang = await tx.preferredLanguage.findFirst({
          where: { code: 'en' },
        });
        const langId = defaultLang?.id || (await tx.preferredLanguage.findFirst())?.id || '';

        const examSection = await tx.examSection.create({
          data: {
            examId: exam.id,
            subjectId: subId,
            name: secName,
            totalQuestions: secRows.length,
            displayOrder: secOrder++,
          },
        });

        for (const r of secRows) {
          const qData = r.data;

          // Create Question in Question Bank
          const question = await tx.question.create({
            data: {
              subjectId: subId,
              chapterId: chapId,
              defaultLanguageId: langId,
              type: (qData.questionType as any) || QuestionTypeEnum.SINGLE_CORRECT,
              difficultyLevel:
                (qData.difficulty as any) || QuestionDifficultyEnum.MEDIUM,
              marks: qData.marks || marksPerQ,
              negativeMarks: qData.negativeMarks || negMarks,
              passage: qData.passageText || null,
              assertion: qData.assertionText || null,
              reason: qData.reasonText || null,
              createdById: userId,
              isActive: true,
            },
          });

          // Create Options
          const createdOptions: any[] = [];
          const optDefs = [
            { key: 'A', text: qData.optionA },
            { key: 'B', text: qData.optionB },
            { key: 'C', text: qData.optionC },
            { key: 'D', text: qData.optionD },
          ];

          for (let optIdx = 0; optIdx < optDefs.length; optIdx++) {
            const od = optDefs[optIdx];
            if (od.text !== undefined && od.text !== null) {
              const opt = await tx.questionOption.create({
                data: {
                  questionId: question.id,
                  optionKey: od.key,
                  optionLabel: od.key,
                  optionText: od.text || '',
                  isCorrect: qData.correctAnswer === od.key,
                  displayOrder: optIdx + 1,
                },
              });
              createdOptions.push(opt);
            }
          }

          // Create Default English Translation
          const defaultLang = await tx.preferredLanguage.findFirst({
            where: { code: 'en' },
          });
          if (defaultLang) {
            await tx.questionTranslation.create({
              data: {
                questionId: question.id,
                languageId: defaultLang.id,
                questionText: qData.questionText || 'Question statement',
                explanation: qData.explanation || null,
              },
            });
          }

          // Link to Exam
          await tx.examQuestion.create({
            data: {
              examId: exam.id,
              sectionId: examSection.id,
              questionId: question.id,
              displayOrder: globalQOrder++,
              marks: qData.marks || marksPerQ,
              negativeMarks: qData.negativeMarks || negMarks,
            },
          });

          createdQuestionTuples.push({
            questionId: question.id,
            sourceRow: qData,
            options: createdOptions,
          });
        }
      }

      // 4. Create Regional Translations
      for (const [langId, tRows] of Object.entries(parsedTranslationsMap)) {
        for (let i = 0; i < createdQuestionTuples.length; i++) {
          const tuple = createdQuestionTuples[i];
          const tRow = tRows[i] || tRows.find((tr) => tr.question_number === tuple.sourceRow.questionNumber);

          if (tRow) {
            const qText = tRow.question_text || tRow.question || tRow.text || tuple.sourceRow.questionText;
            const explanation = tRow.explanation || tuple.sourceRow.explanation;

            await tx.questionTranslation.upsert({
              where: {
                questionId_languageId: {
                  questionId: tuple.questionId,
                  languageId: langId,
                },
              },
              create: {
                questionId: tuple.questionId,
                languageId: langId,
                questionText: qText,
                explanation,
              },
              update: {
                questionText: qText,
                explanation,
              },
            });

            // Option translations
            const tOptions = [
              { key: 'A', text: tRow.option_a },
              { key: 'B', text: tRow.option_b },
              { key: 'C', text: tRow.option_c },
              { key: 'D', text: tRow.option_d },
            ];

            for (const to of tOptions) {
              const matchedOpt = tuple.options.find((o) => o.optionKey === to.key);
              if (matchedOpt && to.text) {
                await tx.questionOptionTranslation.upsert({
                  where: {
                    optionId_languageId: {
                      optionId: matchedOpt.id,
                      languageId: langId,
                    },
                  },
                  create: {
                    optionId: matchedOpt.id,
                    languageId: langId,
                    optionText: to.text,
                  },
                  update: {
                    optionText: to.text,
                  },
                });
              }
            }
          }
        }

        // Link language to Exam
        await tx.examLanguage.upsert({
          where: {
            examId_languageId: {
              examId: exam.id,
              languageId: langId,
            },
          },
          create: {
            examId: exam.id,
            languageId: langId,
            isDefault: false,
          },
          update: {},
        });
      }

      // 5. Create Blueprint Traceability Record
      const examBlueprint = await tx.examBlueprint.create({
        data: {
          examId: exam.id,
          name: `${dto.title} - Blueprint`,
          totalQuestions: paperValidation.totalQuestions,
          version: 1,
          isSystem: false,
          createdById: userId,
        },
      });

      // 6. Create Immutable ExamVersion Snapshot
      const examVersion = await tx.examVersion.create({
        data: {
          examId: exam.id,
          blueprintId: examBlueprint.id,
          versionNumber: 1,
          status: 'GENERATED',
          generationSeed: `exam_upload_${Date.now()}`,
          totalQuestions: paperValidation.totalQuestions,
          durationMinutes: duration,
          totalMarks,
          generatedById: userId,
        },
      });

      // 7. Populate ExamVersionQuestions & Options
      let vSeq = 1;
      for (const tuple of createdQuestionTuples) {
        const vq = await tx.examVersionQuestion.create({
          data: {
            examVersionId: examVersion.id,
            sourceQuestionId: tuple.questionId,
            sequenceNumber: vSeq++,
            sectionName: tuple.sourceRow.sectionName || tuple.sourceRow.subject || 'General',
            subjectName: tuple.sourceRow.subject || 'General',
            type: tuple.sourceRow.questionType || 'SINGLE_CORRECT',
            difficultyLevel: tuple.sourceRow.difficulty || 'MEDIUM',
            marks: tuple.sourceRow.marks || marksPerQ,
            negativeMarks: tuple.sourceRow.negativeMarks || negMarks,
            passage: tuple.sourceRow.passageText || null,
            assertion: tuple.sourceRow.assertionText || null,
            reason: tuple.sourceRow.reasonText || null,
            questionText: tuple.sourceRow.questionText || 'Question statement',
            explanation: tuple.sourceRow.explanation || null,
            correctAnswer: tuple.sourceRow.correctAnswer || null,
          },
        });

        for (let oIdx = 0; oIdx < tuple.options.length; oIdx++) {
          const opt = tuple.options[oIdx];
          await tx.examVersionOption.create({
            data: {
              examVersionQuestionId: vq.id,
              sourceOptionId: opt.id,
              displayOrder: oIdx + 1,
              optionKey: opt.optionKey,
              optionLabel: opt.optionLabel || opt.optionKey,
              optionText: opt.optionText || '',
              isCorrect: opt.isCorrect,
            },
          });
        }
      }

      // 8. Record Audit Log
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'EXAM_CREATED',
          entityType: 'Exam',
          entityId: exam.id,
          metadata: {
            title: exam.title,
            blueprintId: dto.blueprintId,
            totalQuestions: exam.totalQuestions,
            languagesCount: translationFiles.length + 1,
          },
        },
      });

      return {
        examId: exam.id,
        examVersionId: examVersion.id,
        title: exam.title,
        status: 'DRAFT',
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
        languagesCount: translationFiles.length + 1,
        createdAt: exam.createdAt,
      };
    });
  }

  /**
   * 4. List All Exams with Rich Status, Search, Type Filter, Translation Coverage & Pagination
   * GET /admin/exam-manager/exams
   */
  async getAllExamsList(query: ExamManagerFilterDto) {
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.search && query.search.trim()) {
      where.OR = [
        { title: { contains: query.search.trim(), mode: 'insensitive' } },
        { description: { contains: query.search.trim(), mode: 'insensitive' } },
        {
          sections: {
            some: {
              name: { contains: query.search.trim(), mode: 'insensitive' },
            },
          },
        },
      ];
    }

    if (query.status && query.status !== 'ALL') {
      where.status = { name: query.status };
    }

    if (query.type && query.type !== 'ALL') {
      if (query.type === 'MOCK') {
        where.title = { contains: 'Mock', mode: 'insensitive' };
      } else if (query.type === 'SUBJECT_MOCK') {
        where.sections = { some: {} };
      } else if (query.type === 'LIVE') {
        where.NOT = { title: { contains: 'Mock', mode: 'insensitive' } };
      }
    }

    const [exams, total] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          examTarget: { select: { id: true, name: true } },
          status: { select: { id: true, name: true } },
          createdBy: {
            select: { id: true, email: true, student: { select: { name: true } } },
          },
          languages: {
            include: {
              language: {
                select: { id: true, name: true, code: true, nativeName: true },
              },
            },
          },
          sections: {
            select: {
              id: true,
              name: true,
              subject: { select: { id: true, name: true } },
            },
          },
          _count: {
            select: { examQuestions: true, attempts: true, sections: true },
          },
        },
      }),
      this.prisma.exam.count({ where }),
    ]);

    // Fetch all preferred languages for coverage calculations
    const allLanguages = await this.prisma.preferredLanguage.findMany({
      where: { isActive: true },
    });

    const items = await Promise.all(
      exams.map(async (exam) => {
        const totalQ = exam._count.examQuestions || exam.totalQuestions || 1;
        const translationCoverage: Record<string, number> = {};

        for (const lang of allLanguages) {
          const lCode = (lang.code || lang.name).toUpperCase();
          if (lCode === 'EN') {
            translationCoverage[lCode] = 100;
          } else {
            const count = await this.prisma.questionTranslation.count({
              where: {
                languageId: lang.id,
                question: {
                  examQuestions: { some: { examId: exam.id } },
                },
              },
            });
            const pct = Math.min(100, Math.round((count / totalQ) * 100));
            if (pct > 0) {
              translationCoverage[lCode] = pct;
            }
          }
        }

        const isMock = /mock/i.test(exam.title);
        const type = isMock ? 'MOCK' : 'LIVE';
        const typeLabel = isMock ? 'Mock Test' : 'Live Exam';
        const subjectsSummary = exam.sections
          .map((s) => s.subject?.name || s.name)
          .filter(Boolean)
          .join(', ') || 'All Subjects';

        return {
          id: exam.id,
          title: exam.title,
          description: exam.description,
          type,
          typeLabel,
          examTarget: exam.examTarget,
          subjectsSummary,
          totalQuestions: exam.totalQuestions,
          totalMarks: exam.totalMarks,
          durationMinutes: exam.durationMinutes,
          status: exam.status?.name || 'DRAFT',
          createdAt: exam.createdAt,
          updatedAt: exam.updatedAt,
          createdBy: {
            id: exam.createdBy?.id,
            email: exam.createdBy?.email,
            name: exam.createdBy?.student?.name || exam.createdBy?.email || 'Admin',
          },
          translationCoverage,
          languages: exam.languages.map((l) => ({
            id: l.language.id,
            name: l.language.name,
            code: l.language.code,
          })),
        };
      }),
    );

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
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

