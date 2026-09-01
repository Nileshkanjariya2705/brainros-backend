import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import {
  SUPPORTED_SUBJECT_NAMES,
  GenerateSubjectMockDto,
} from '../dto/subject-mock.dto';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export interface SubjectMockStatItem {
  id: string;
  name: string;
  normalizedName: string;
  code: string | null;
  chapterCount: number;
  questionCount: number;
  isActive: boolean;
}

@Injectable()
export class SubjectMockService {
  private readonly logger = new Logger(SubjectMockService.name);
  private readonly storageDir = path.resolve(
    process.cwd(),
    'storage',
    'subject-mock-imports',
  );

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Normalize and strictly validate that the subject is one of the 4 supported subjects:
   * PHYSICS, CHEMISTRY, MATHEMATICS, BIOLOGY.
   */
  normalizeAndValidateSubject(subjectInput: string): string {
    if (!subjectInput) {
      throw new BadRequestException('Subject is required.');
    }

    const upper = subjectInput.trim().toUpperCase();
    let matched: string | null = null;

    if (upper.includes('PHYSIC')) matched = 'PHYSICS';
    else if (upper.includes('CHEM')) matched = 'CHEMISTRY';
    else if (upper.includes('MATH')) matched = 'MATHEMATICS';
    else if (upper.includes('BIO')) matched = 'BIOLOGY';

    if (!matched || !SUPPORTED_SUBJECT_NAMES.includes(matched as any)) {
      throw new BadRequestException(
        `Invalid subject '${subjectInput}'. Supported subjects: ${SUPPORTED_SUBJECT_NAMES.join(', ')}`,
      );
    }

    return matched;
  }

  /**
   * Retrieve stats (chapters and questions) for the 4 supported subjects.
   * If Mathematics or other supported subject is missing in DB, ensures it exists.
   */
  async getSubjectStats(): Promise<SubjectMockStatItem[]> {
    // 1. Fetch default exam target if needed
    const defaultTarget = await this.prisma.examTarget.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    const allSubjects = await this.prisma.subject.findMany({
      include: {
        _count: {
          select: {
            chapters: true,
            questions: true,
          },
        },
      },
    });

    const results: SubjectMockStatItem[] = [];

    for (const supName of SUPPORTED_SUBJECT_NAMES) {
      // Find matching subject in DB
      let found = allSubjects.find(
        (s) =>
          s.name.toUpperCase() === supName ||
          s.name.toUpperCase().startsWith(supName) ||
          (supName === 'MATHEMATICS' && s.name.toUpperCase().includes('MATH')),
      );

      // If missing, auto-create subject in master data
      if (!found && defaultTarget) {
        found = await this.prisma.subject.create({
          data: {
            examTargetId: defaultTarget.id,
            name: supName.charAt(0) + supName.slice(1).toLowerCase(),
            code: supName.substring(0, 4),
            displayOrder: results.length + 1,
            isActive: true,
          },
          include: {
            _count: { select: { chapters: true, questions: true } },
          },
        });
      }

      if (found) {
        results.push({
          id: found.id,
          name: found.name,
          normalizedName: supName,
          code: found.code,
          chapterCount: found._count?.chapters || 0,
          questionCount: found._count?.questions || 0,
          isActive: found.isActive,
        });
      }
    }

    return results;
  }

  /**
   * Download a clean CSV / XLSX template pre-configured with sample questions for the selected subject.
   */
  async generateTemplate(
    subjectInput: string,
    format: 'xlsx' | 'csv' = 'xlsx',
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    const normalizedSubject = this.normalizeAndValidateSubject(subjectInput);
    const displaySubjectName =
      normalizedSubject.charAt(0) + normalizedSubject.slice(1).toLowerCase();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`${displaySubjectName} Mock Template`);

    // Standard Question Bank Columns
    sheet.columns = [
      { header: 'question_id', key: 'question_id', width: 22 },
      { header: 'subject', key: 'subject', width: 18 },
      { header: 'chapter', key: 'chapter', width: 24 },
      { header: 'topic', key: 'topic', width: 20 },
      { header: 'sub_topic', key: 'sub_topic', width: 20 },
      { header: 'question_type', key: 'question_type', width: 20 },
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

    // Header styling
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }, // Indigo-600
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // Sample question tailored to selected subject
    let sampleChapter = 'Kinematics';
    let sampleTopic = 'Motion in 1D';
    let sampleQuestion = 'What is the SI unit of velocity?';
    let optA = 'm/s';
    let optB = 'm/s^2';
    let optC = 'km/h^2';
    let optD = 'N/m';

    if (normalizedSubject === 'CHEMISTRY') {
      sampleChapter = 'Chemical Bonding';
      sampleTopic = 'Molecular Geometry';
      sampleQuestion = 'What is the molecular geometry of methane (CH4)?';
      optA = 'Tetrahedral';
      optB = 'Trigonal Planar';
      optC = 'Linear';
      optD = 'Octahedral';
    } else if (normalizedSubject === 'MATHEMATICS') {
      sampleChapter = 'Calculus';
      sampleTopic = 'Differentiation';
      sampleQuestion = 'What is the derivative of sin(x) with respect to x?';
      optA = 'cos(x)';
      optB = '-cos(x)';
      optC = 'tan(x)';
      optD = '-sin(x)';
    } else if (normalizedSubject === 'BIOLOGY') {
      sampleChapter = 'Cell Biology';
      sampleTopic = 'Cell Organelles';
      sampleQuestion = 'Which organelle is known as the powerhouse of the cell?';
      optA = 'Mitochondria';
      optB = 'Ribosome';
      optC = 'Endoplasmic Reticulum';
      optD = 'Golgi Apparatus';
    }

    sheet.addRow({
      question_id: '',
      subject: displaySubjectName,
      chapter: sampleChapter,
      topic: sampleTopic,
      sub_topic: 'Fundamentals',
      question_type: 'SINGLE_CORRECT',
      difficulty: 'MEDIUM',
      marks: 4,
      negative_marks: 1,
      question_text: sampleQuestion,
      option_a: optA,
      option_b: optB,
      option_c: optC,
      option_d: optD,
      correct_answer: 'A',
      explanation: `Option A is the correct answer based on standard ${displaySubjectName} principles.`,
    });

    sheet.addRow({
      question_id: '',
      subject: displaySubjectName,
      chapter: sampleChapter,
      topic: sampleTopic,
      sub_topic: 'Application',
      question_type: 'SINGLE_CORRECT',
      difficulty: 'EASY',
      marks: 4,
      negative_marks: 1,
      question_text: `Sample question 2 for ${displaySubjectName}?`,
      option_a: 'Option 1',
      option_b: 'Option 2',
      option_c: 'Option 3',
      option_d: 'Option 4',
      correct_answer: 'B',
      explanation: 'Explanation for sample question 2.',
    });

    if (format === 'csv') {
      const csvBuffer = await workbook.csv.writeBuffer();
      return {
        buffer: Buffer.from(csvBuffer),
        fileName: `${displaySubjectName.toLowerCase()}_mock_template.csv`,
        contentType: 'text/csv',
      };
    }

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(xlsxBuffer),
      fileName: `${displaySubjectName.toLowerCase()}_mock_template.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /**
   * Upload and validate a CSV/XLSX file against a specific subject.
   */
  async uploadAndValidate(
    file: { originalname: string; size: number; buffer: Buffer; mimetype?: string },
    subjectInput: string,
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided for upload.');
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

    const expectedNormalizedSubject =
      this.normalizeAndValidateSubject(subjectInput);
    const expectedDisplaySubject =
      expectedNormalizedSubject.charAt(0) +
      expectedNormalizedSubject.slice(1).toLowerCase();

    // 1. Parse Excel / CSV rows into objects
    const workbook = new ExcelJS.Workbook();
    if (ext === '.csv') {
      const { Readable } = await import('stream');
      await workbook.csv.read(Readable.from(file.buffer));
    } else {
      await workbook.xlsx.load(file.buffer as any);
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException(
        'The uploaded file is empty or contains only header row.',
      );
    }

    // Extract headers from Row 1
    const headerRow = worksheet.getRow(1);
    const columnMap = new Map<string, number>(); // key -> colIndex (1-based)
    headerRow.eachCell((cell, colNumber) => {
      const val = cell.value ? String(cell.value).trim().toLowerCase() : '';
      if (val) {
        columnMap.set(val, colNumber);
      }
    });

    const getVal = (row: ExcelJS.Row, key: string): string => {
      const col = columnMap.get(key.toLowerCase());
      if (!col) return '';
      const cell = row.getCell(col);
      return cell.value !== null && cell.value !== undefined
        ? String(cell.value).trim()
        : '';
    };

    // Load Syllabus Taxonomy for Validation
    const subjectRecords = await this.prisma.subject.findMany({
      include: {
        chapters: {
          include: {
            topics: {
              include: {
                subTopics: true,
              },
            },
          },
        },
      },
    });

    let targetSubjectRecord: any = subjectRecords.find(
      (s) =>
        s.name.toUpperCase() === expectedNormalizedSubject ||
        s.name.toUpperCase().includes(expectedNormalizedSubject),
    );

    if (!targetSubjectRecord) {
      targetSubjectRecord = subjectRecords.find((s) =>
        s.name.toUpperCase().includes(expectedNormalizedSubject.slice(0, 4)),
      );
    }

    if (!targetSubjectRecord) {
      const existing = await this.prisma.subject.findFirst();
      if (existing) {
        targetSubjectRecord = await this.prisma.subject.findUnique({
          where: { id: existing.id },
          include: { chapters: { include: { topics: true } } },
        });
      }
    }

    const defaultLanguage = await this.prisma.preferredLanguage.findFirst({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    const fallbackLang =
      defaultLanguage || (await this.prisma.preferredLanguage.findFirst());

    // 2. Process and validate rows
    let totalRows = 0;
    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;

    const seenQuestionTexts = new Set<string>();
    const parsedRows: any[] = [];
    const difficultyCounts = {
      EASY: 0,
      MEDIUM: 0,
      HARD: 0,
      VERY_HARD: 0,
    };

    const storedFileName = `${Date.now()}_${path.basename(file.originalname)}`;
    const storagePath = path.join(this.storageDir, storedFileName);
    await fs.promises.writeFile(storagePath, file.buffer);

    // Create import record
    const importRecord = await this.prisma.questionImport.create({
      data: {
        fileName: file.originalname,
        fileType: ext.replace('.', '').toUpperCase(),
        storageKey: storagePath,
        fileSize: file.size,
        status: 'PENDING' as any,
        createdById: userId,
      },
    });

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const questionText =
        getVal(row, 'question_text') || getVal(row, 'question');
      if (!questionText) {
        // Skip completely empty row
        continue;
      }

      totalRows++;
      const errors: string[] = [];

      const rawSubject = getVal(row, 'subject');
      const rawChapter = getVal(row, 'chapter');
      const rawTopic = getVal(row, 'topic');
      const rawSubTopic = getVal(row, 'sub_topic');
      const rawType = (
        getVal(row, 'question_type') ||
        getVal(row, 'type') ||
        'SINGLE_CORRECT'
      ).toUpperCase();
      const rawDiff = (
        getVal(row, 'difficulty') ||
        getVal(row, 'difficulty_level') ||
        'MEDIUM'
      ).toUpperCase();
      const rawMarks = Number(getVal(row, 'marks') || 4);
      const rawNegMarks = Number(getVal(row, 'negative_marks') || 1);
      const optA = getVal(row, 'option_a') || getVal(row, 'optiona');
      const optB = getVal(row, 'option_b') || getVal(row, 'optionb');
      const optC = getVal(row, 'option_c') || getVal(row, 'optionc');
      const optD = getVal(row, 'option_d') || getVal(row, 'optiond');
      const correctAnswer = (
        getVal(row, 'correct_answer') ||
        getVal(row, 'answer') ||
        'A'
      ).toUpperCase();
      const explanation = getVal(row, 'explanation');

      // ── Strict Subject Validation ─────────────────────────────
      if (!rawSubject) {
        errors.push('Subject is required.');
      } else {
        const rowNormSub = rawSubject.trim().toUpperCase();
        const isMatched =
          rowNormSub === expectedNormalizedSubject ||
          rowNormSub.startsWith(expectedNormalizedSubject) ||
          (expectedNormalizedSubject === 'MATHEMATICS' &&
            rowNormSub.includes('MATH'));

        if (!isMatched) {
          errors.push(
            `Invalid Subject. Expected: ${expectedDisplaySubject}, Found: ${rawSubject.trim()}`,
          );
        }
      }

      // ── Chapter Validation ────────────────────────────────────
      let matchedChapter: any = null;
      if (!rawChapter) {
        errors.push('Chapter is required.');
      } else if (targetSubjectRecord) {
        matchedChapter = targetSubjectRecord.chapters.find(
          (c) => c.name.toLowerCase() === rawChapter.trim().toLowerCase(),
        );
        if (!matchedChapter) {
          // Chapter not strictly in DB, but we allow creating or linking if name is valid
          // If chapter matches another subject in DB, reject it!
          const belongsToOtherSubject = subjectRecords.find(
            (otherSub) =>
              otherSub.id !== targetSubjectRecord?.id &&
              otherSub.chapters.some(
                (ch) => ch.name.toLowerCase() === rawChapter.trim().toLowerCase(),
              ),
          );
          if (belongsToOtherSubject) {
            errors.push(
              `Chapter '${rawChapter}' belongs to ${belongsToOtherSubject.name}, not ${expectedDisplaySubject}.`,
            );
          }
        }
      }

      // ── Question Text & Duplicate Detection ───────────────────
      const normalizedQText = questionText
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      let isDuplicate = false;
      if (seenQuestionTexts.has(normalizedQText)) {
        isDuplicate = true;
        duplicateRows++;
        errors.push('Duplicate question detected inside uploaded file.');
      } else {
        seenQuestionTexts.add(normalizedQText);
      }

      // ── Difficulty Level Validation ───────────────────────────
      let diffLevel = 'MEDIUM';
      if (['EASY', 'MEDIUM', 'HARD', 'VERY_HARD'].includes(rawDiff)) {
        diffLevel = rawDiff;
      } else {
        errors.push(
          `Invalid difficulty '${rawDiff}'. Allowed: EASY, MEDIUM, HARD, VERY_HARD.`,
        );
      }

      // ── Options Validation for MCQ ────────────────────────────
      if (rawType === 'SINGLE_CORRECT' || rawType === 'MULTIPLE_CORRECT') {
        if (!optA || !optB) {
          errors.push('At least Option A and Option B are required for MCQ.');
        }
        if (
          !correctAnswer ||
          !['A', 'B', 'C', 'D', 'E', 'F'].some((k) => correctAnswer.includes(k))
        ) {
          errors.push(
            `Invalid correct answer '${correctAnswer}'. Expected one of: A, B, C, D.`,
          );
        }
      }

      const isValid = errors.length === 0 && !isDuplicate;
      if (isValid) {
        validRows++;
        difficultyCounts[diffLevel as keyof typeof difficultyCounts]++;
      } else if (!isDuplicate) {
        invalidRows++;
      }

      const optionsData = [
        optA && {
          optionKey: 'A',
          optionLabel: 'A',
          optionText: optA,
          isCorrect: correctAnswer.includes('A'),
          displayOrder: 1,
        },
        optB && {
          optionKey: 'B',
          optionLabel: 'B',
          optionText: optB,
          isCorrect: correctAnswer.includes('B'),
          displayOrder: 2,
        },
        optC && {
          optionKey: 'C',
          optionLabel: 'C',
          optionText: optC,
          isCorrect: correctAnswer.includes('C'),
          displayOrder: 3,
        },
        optD && {
          optionKey: 'D',
          optionLabel: 'D',
          optionText: optD,
          isCorrect: correctAnswer.includes('D'),
          displayOrder: 4,
        },
      ].filter(Boolean);

      const rowPayload = {
        rowNumber,
        subject: rawSubject || expectedDisplaySubject,
        chapter: rawChapter,
        topic: rawTopic,
        subTopic: rawSubTopic,
        questionType: rawType,
        difficulty: diffLevel,
        marks: rawMarks,
        negativeMarks: rawNegMarks,
        questionText,
        options: optionsData,
        correctAnswer,
        explanation,
        status: isDuplicate ? 'DUPLICATE' : isValid ? 'VALID' : 'INVALID',
        errors,
      };

      parsedRows.push(rowPayload);

      // Save to QuestionImportRow for staging & persistent generation
      if (isValid && targetSubjectRecord) {
        // Resolve or create chapter if needed
        let chapterId = matchedChapter?.id;
        if (!chapterId && rawChapter) {
          const newChap = await this.prisma.chapter.create({
            data: {
              subjectId: targetSubjectRecord.id,
              name: rawChapter.trim(),
              displayOrder: 99,
              isActive: true,
            },
          });
          chapterId = newChap.id;
        }

        const dtoData = {
          subjectId: targetSubjectRecord.id,
          chapterId: chapterId || targetSubjectRecord.chapters[0]?.id || targetSubjectRecord.id,
          difficultyLevel: diffLevel,
          type: rawType,
          defaultLanguageId: fallbackLang?.id,
          marks: rawMarks,
          negativeMarks: rawNegMarks,
          options: optionsData,
          translations: fallbackLang
            ? [
                {
                  languageId: fallbackLang.id,
                  questionText,
                  explanation,
                },
              ]
            : [],
          explanation: explanation ? { explanation } : undefined,
          answer: { correctOptionIds: [correctAnswer] },
        };

        await this.prisma.questionImportRow.create({
          data: {
            importId: importRecord.id,
            rowNumber,
            status: 'VALID',
            action: 'CREATE' as any,
            rawData: rowPayload,
            dtoData,
          },
        });
      } else {
        await this.prisma.questionImportRow.create({
          data: {
            importId: importRecord.id,
            rowNumber,
            status: isDuplicate ? 'DUPLICATE' : 'INVALID',
            action: 'CREATE' as any,
            rawData: rowPayload,
            errors: errors.map((msg) => ({ field: 'general', message: msg })),
          },
        });
      }
    }

    // Update session status
    await this.prisma.questionImport.update({
      where: { id: importRecord.id },
      data: {
        status: 'VALIDATED',
        totalRows,
        validRows,
        invalidRows: invalidRows + duplicateRows,
      },
    });

    return {
      importId: importRecord.id,
      fileName: file.originalname,
      fileSize: file.size,
      subject: expectedDisplaySubject,
      totalRows,
      validRows,
      invalidRows,
      duplicateRows,
      difficultyCounts,
      previewRows: parsedRows.slice(0, 100), // First 100 rows for preview table
      allRowsCount: parsedRows.length,
    };
  }

  /**
   * Transactionally generate the Subject-wise Mock Exam from validated questions.
   */
  async generateSubjectMockExam(
    dto: GenerateSubjectMockDto,
    userId: string,
  ) {
    const normalizedSubject = this.normalizeAndValidateSubject(dto.subject);
    const displaySubjectName =
      normalizedSubject.charAt(0) + normalizedSubject.slice(1).toLowerCase();

    const importRecord = await this.prisma.questionImport.findUnique({
      where: { id: dto.importId },
    });

    if (!importRecord) {
      throw new NotFoundException(`Import session '${dto.importId}' not found.`);
    }

    // 1. Fetch all VALID candidate rows from this import session
    const candidateRows = await this.prisma.questionImportRow.findMany({
      where: {
        importId: dto.importId,
        status: 'VALID',
      },
      orderBy: { rowNumber: 'asc' },
    });

    if (candidateRows.length === 0) {
      throw new BadRequestException(
        `No valid questions found in this ${displaySubjectName} upload session to generate a mock test.`,
      );
    }

    const requestedTotalQuestions = dto.totalQuestions || candidateRows.length;
    if (candidateRows.length < requestedTotalQuestions) {
      throw new BadRequestException(
        `Cannot generate mock test. Required questions: ${requestedTotalQuestions}, but only ${candidateRows.length} valid questions available in uploaded file.`,
      );
    }

    // 2. Ensure all questions exist in Question table
    for (const row of candidateRows) {
      if (!row.resultQuestionId && row.dtoData) {
        const qDto = row.dtoData as any;
        const created = await this.prisma.question.create({
          data: {
            subjectId: qDto.subjectId,
            chapterId: qDto.chapterId,
            topicId: qDto.topicId || undefined,
            difficultyLevel: qDto.difficultyLevel,
            type: qDto.type,
            defaultLanguageId: qDto.defaultLanguageId,
            marks: qDto.marks || dto.defaultMarksPerQuestion || 4,
            negativeMarks: qDto.negativeMarks || dto.defaultNegativeMarks || 1,
            passage: qDto.passage || undefined,
            assertion: qDto.assertion || undefined,
            reason: qDto.reason || undefined,
            correctAnswer: qDto.answer?.correctOptionIds || null,
            createdById: userId,
            status: 'APPROVED',
            options: {
              create: (qDto.options || []).map((o: any, idx: number) => ({
                optionKey: o.optionKey || String.fromCharCode(65 + idx),
                optionLabel:
                  o.optionLabel || o.optionKey || String.fromCharCode(65 + idx),
                optionText: o.optionText || '',
                isCorrect: o.isCorrect || false,
                displayOrder: o.displayOrder || idx + 1,
              })),
            },
            translations: {
              create: (qDto.translations || []).map((t: any) => ({
                languageId: t.languageId,
                questionText: t.questionText || '',
                explanation: t.explanation || '',
              })),
            },
            explanation: qDto.explanation
              ? { create: { explanation: qDto.explanation.explanation } }
              : undefined,
          },
        });

        await this.prisma.questionImportRow.update({
          where: { id: row.id },
          data: {
            importStatus: 'SUCCESS',
            resultQuestionId: created.id,
          },
        });
      }
    }

    // 3. Select final questions for exam (sliced to requested totalQuestions)
    const finalizedRows = await this.prisma.questionImportRow.findMany({
      where: {
        importId: dto.importId,
        resultQuestionId: { not: null },
      },
      orderBy: { rowNumber: 'asc' },
      take: requestedTotalQuestions,
    });

    const questionIds = finalizedRows
      .map((r) => r.resultQuestionId as string)
      .filter(Boolean);

    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      include: {
        subject: { select: { id: true, name: true, examTargetId: true } },
        chapter: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
        options: { orderBy: { displayOrder: 'asc' } },
        translations: true,
        explanation: true,
        answer: true,
      },
    });

    const questionMap = new Map<string, any>(questions.map((q) => [q.id, q]));
    const orderedQuestions: any[] = [];
    for (const qId of questionIds) {
      const q = questionMap.get(qId);
      if (q) orderedQuestions.push(q);
    }

    if (orderedQuestions.length === 0) {
      throw new BadRequestException('Failed to assemble question pool for mock generation.');
    }

    // 4. Resolve Target Curriculum & Subject
    const subjectId = orderedQuestions[0]?.subjectId;
    let targetExamId = orderedQuestions[0]?.subject?.examTargetId;
    if (!targetExamId) {
      const defaultTarget = await this.prisma.examTarget.findFirst();
      targetExamId = defaultTarget?.id || '';
    }

    const marksPerQ = dto.defaultMarksPerQuestion || 4;
    const negMarks = dto.defaultNegativeMarks || 1;
    const totalMarks = orderedQuestions.reduce(
      (sum, q) => sum + (q.marks || marksPerQ),
      0,
    );
    const duration = dto.durationMinutes || 60;

    const statusName = dto.publishImmediately ? 'APPROVED' : 'DRAFT';
    let targetStatus = await this.prisma.examStatus.findUnique({
      where: { name: statusName },
    });
    if (!targetStatus) {
      targetStatus = await this.prisma.examStatus.findFirst();
    }

    if (!targetStatus) {
      throw new NotFoundException('ExamStatus not found in database');
    }

    // 5. Transactionally create Exam, Sections, Questions, Blueprint, and ExamVersion Snapshot
    const result = await this.prisma.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          examTargetId: targetExamId,
          title: dto.title.trim(),
          description:
            dto.description ||
            `${displaySubjectName} Mock Test generated from uploaded file: ${importRecord.fileName} (${orderedQuestions.length} Questions)`,
          totalQuestions: orderedQuestions.length,
          totalMarks,
          durationMinutes: duration,
          defaultMarksPerQuestion: marksPerQ,
          defaultNegativeMarks: negMarks,
          statusId: targetStatus.id,
          createdById: userId,
        },
      });

      // Single Section for this Subject
      const examSection = await tx.examSection.create({
        data: {
          examId: exam.id,
          subjectId,
          name: displaySubjectName,
          totalQuestions: orderedQuestions.length,
          displayOrder: 1,
        },
      });

      let qOrder = 1;
      for (const q of orderedQuestions) {
        await tx.examQuestion.create({
          data: {
            examId: exam.id,
            sectionId: examSection.id,
            questionId: q.id,
            displayOrder: qOrder++,
            marks: q.marks || marksPerQ,
            negativeMarks: q.negativeMarks || negMarks,
          },
        });
      }

      // Create Blueprint record for traceability
      const blueprint = await tx.examBlueprint.create({
        data: {
          examId: exam.id,
          name: `${dto.title} - ${displaySubjectName} Blueprint`,
          totalQuestions: orderedQuestions.length,
          version: 1,
          isSystem: false,
          createdById: userId,
        },
      });

      // Create Immutable ExamVersion snapshot
      const examVersion = await tx.examVersion.create({
        data: {
          examId: exam.id,
          blueprintId: blueprint.id,
          versionNumber: 1,
          status: dto.publishImmediately ? 'PUBLISHED' : 'GENERATED',
          generationSeed: `subject_mock_${displaySubjectName.toLowerCase()}_${Date.now()}`,
          totalQuestions: orderedQuestions.length,
          durationMinutes: duration,
          totalMarks,
          generatedById: userId,
        },
      });

      let vSeq = 1;
      for (const q of orderedQuestions) {
        const defaultTrans = q.translations?.[0];
        const vQuestion = await tx.examVersionQuestion.create({
          data: {
            examVersionId: examVersion.id,
            sourceQuestionId: q.id,
            sequenceNumber: vSeq++,
            sectionName: displaySubjectName,
            subjectName: displaySubjectName,
            type: q.type,
            difficultyLevel: q.difficultyLevel,
            marks: q.marks || marksPerQ,
            negativeMarks: q.negativeMarks || negMarks,
            passage: q.passage,
            assertion: q.assertion,
            reason: q.reason,
            questionText:
              defaultTrans?.questionText ||
              q.passage ||
              'Question statement',
            explanation:
              q.explanation?.explanation || defaultTrans?.explanation || null,
            correctAnswer: q.correctAnswer || q.answer?.correctOptionIds || null,
          },
        });

        for (let optIdx = 0; optIdx < (q.options || []).length; optIdx++) {
          const opt = q.options[optIdx];
          await tx.examVersionOption.create({
            data: {
              examVersionQuestionId: vQuestion.id,
              sourceOptionId: opt.id,
              displayOrder: optIdx + 1,
              optionKey: opt.optionKey,
              optionLabel: opt.optionLabel || opt.optionKey,
              optionText: opt.optionText || '',
              isCorrect: opt.isCorrect,
            },
          });
        }
      }

      return {
        examId: exam.id,
        examVersionId: examVersion.id,
        title: exam.title,
        subject: displaySubjectName,
        status: statusName,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
        createdAt: exam.createdAt,
      };
    });

    this.logger.log(
      `Subject Mock Test '${result.title}' generated successfully (Exam ID: ${result.examId}, Subject: ${displaySubjectName})`,
    );

    return result;
  }
}
