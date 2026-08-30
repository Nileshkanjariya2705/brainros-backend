import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ParsedExamPaperRow,
  ExamPaperValidationResult,
  ExamPaperValidationError,
} from '../dto/exam-manager.dto';

const VALID_QUESTION_TYPES = new Set([
  'SINGLE_CORRECT',
  'MULTIPLE_CORRECT',
  'NUMERICAL',
  'ASSERTION_REASON',
  'MATCH_FOLLOWING',
  'CASE_BASED',
]);

const VALID_DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD', 'VERY_HARD']);

@Injectable()
export class ExamPaperValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate entire parsed question paper dataset
   */
  async validatePaper(
    rows: ParsedExamPaperRow[],
  ): Promise<ExamPaperValidationResult> {
    const errors: ExamPaperValidationError[] = [];
    const warnings: string[] = [];

    if (!rows || rows.length === 0) {
      return {
        isValid: false,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        examCount: 0,
        examCode: '',
        examTitle: '',
        durationMinutes: 0,
        totalMarks: 0,
        totalQuestions: 0,
        sections: [],
        errors: [{ row: 0, message: 'Spreadsheet contains no data rows.' }],
        warnings: [],
        validatedRows: [],
      };
    }

    // 1. Build academic cache for fast lookup
    const [examTargets, subjects, languages] = await Promise.all([
      this.prisma.examTarget.findMany({ select: { id: true, name: true } }),
      this.prisma.subject.findMany({
        select: { id: true, name: true, examTargetId: true },
      }),
      this.prisma.preferredLanguage.findMany({
        select: { id: true, code: true, name: true },
      }),
    ]);

    const targetMap = new Map(
      examTargets.map((t) => [t.name.toUpperCase(), t]),
    );
    const subjectMap = new Map(
      subjects.map((s) => [s.name.toUpperCase(), s]),
    );
    const langMap = new Map(
      languages.map((l) => [(l.code || '').toLowerCase(), l]),
    );

    // Primary exam metadata from first row
    const firstRow = rows[0];
    const examCode = (firstRow.examCode || '').trim().toUpperCase();
    const examTitle = (firstRow.examName || 'Imported Exam Paper').trim();
    const durationMinutes = firstRow.durationMinutes || 200;

    if (!examCode) {
      errors.push({
        row: firstRow.rowNumber,
        column: 'exam_code',
        message: 'Exam Code is required in question paper (e.g. NEET-2026-MOCK-01).',
      });
    }

    // Check if exam code already exists in database
    const existingExam = examCode
      ? await this.prisma.exam.findFirst({
          where: { title: examTitle },
        })
      : null;

    if (existingExam) {
      warnings.push(
        `An exam with title '${examTitle}' already exists in database. Importing will create a new distinct edition.`,
      );
    }

    let calculatedTotalMarks = 0;
    const sectionMap = new Map<string, { name: string; subject: string; questionCount: number }>();
    const seenQuestionTexts = new Set<string>();

    const validatedRows: Array<{
      rowNumber: number;
      isValid: boolean;
      errors: string[];
      warnings: string[];
      data: ParsedExamPaperRow;
    }> = [];

    let validRowCount = 0;
    let invalidRowCount = 0;

    for (const row of rows) {
      const rowErrors: string[] = [];
      const rowWarnings: string[] = [];

      // 1. Validate Subject
      const rawSubject = (row.subject || '').trim().toUpperCase();
      if (!rawSubject) {
        rowErrors.push('Subject name is required.');
      } else {
        const matchedSubject = subjectMap.get(rawSubject);
        if (!matchedSubject) {
          // Allow fallback to create subject if needed, or flag error
          // Try case-insensitive matching
          const found = Array.from(subjectMap.entries()).find(([k]) =>
            k.includes(rawSubject) || rawSubject.includes(k),
          );
          if (!found) {
            rowWarnings.push(
              `Subject '${row.subject}' not found in database. System will auto-create subject under target.`,
            );
          }
        }
      }

      // 2. Validate Question Text
      const qText = (row.questionText || '').trim();
      if (!qText) {
        rowErrors.push('Question statement (question_text) is required.');
      } else {
        if (seenQuestionTexts.has(qText.toLowerCase())) {
          rowWarnings.push('Duplicate question statement in same question paper.');
        } else {
          seenQuestionTexts.add(qText.toLowerCase());
        }
      }

      // 3. Validate Question Type
      const qType = (row.questionType || 'SINGLE_CORRECT').trim().toUpperCase();
      if (!VALID_QUESTION_TYPES.has(qType)) {
        rowErrors.push(
          `Invalid question_type '${row.questionType}'. Allowed types: SINGLE_CORRECT, MULTIPLE_CORRECT, NUMERICAL, ASSERTION_REASON, CASE_BASED, MATCH_FOLLOWING.`,
        );
      }

      // 4. Validate Options & Correct Answer
      const optA = (row.optionA || '').trim();
      const optB = (row.optionB || '').trim();
      const optC = (row.optionC || '').trim();
      const optD = (row.optionD || '').trim();
      const correctAns = (row.correctAnswer || '').trim().toUpperCase();

      if (
        qType === 'SINGLE_CORRECT' ||
        qType === 'MULTIPLE_CORRECT' ||
        qType === 'ASSERTION_REASON'
      ) {
        if (!optA || !optB) {
          rowErrors.push('Options A and B are required for MCQ questions.');
        }

        if (!correctAns) {
          rowErrors.push('Correct answer is required (e.g. A, B, C, or D).');
        } else {
          if (qType === 'SINGLE_CORRECT' || qType === 'ASSERTION_REASON') {
            if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(correctAns)) {
              rowErrors.push(
                `Invalid correct_answer '${row.correctAnswer}'. Must be a single option key like A, B, C, or D.`,
              );
            }
          } else if (qType === 'MULTIPLE_CORRECT') {
            const parts = correctAns.split(/[\s,;]+/).filter(Boolean);
            const invalid = parts.filter(
              (p) => !['A', 'B', 'C', 'D', 'E', 'F'].includes(p),
            );
            if (invalid.length > 0) {
              rowErrors.push(
                `Invalid correct_answer '${row.correctAnswer}'. For MULTIPLE_CORRECT, specify comma-separated keys (e.g. A,B or A,C,D).`,
              );
            }
          }
        }
      } else if (qType === 'NUMERICAL') {
        if (!correctAns) {
          rowErrors.push('Numerical correct answer value is required.');
        } else if (isNaN(Number(correctAns))) {
          rowErrors.push(
            `Numerical answer '${row.correctAnswer}' is not a valid number.`,
          );
        }
      }

      // 5. Validate Marks
      const marks = row.marks !== undefined ? row.marks : 4.0;
      const negMarks = row.negativeMarks !== undefined ? row.negativeMarks : 1.0;
      if (marks <= 0) {
        rowErrors.push('Question marks must be greater than 0.');
      }
      if (negMarks < 0) {
        rowErrors.push('Negative marks cannot be negative.');
      }

      // 6. Validate Difficulty
      const diff = (row.difficulty || 'MEDIUM').trim().toUpperCase();
      if (!VALID_DIFFICULTIES.has(diff)) {
        rowWarnings.push(
          `Unknown difficulty '${row.difficulty}'. Defaulting to MEDIUM.`,
        );
      }

      // 7. Track Sections
      const sectionKey = `${row.subject || 'General'}::${
        row.sectionName || `${row.subject || 'General'} Section`
      }`;
      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, {
          name: row.sectionName || `${row.subject || 'General'} Section`,
          subject: row.subject || 'General',
          questionCount: 0,
        });
      }
      sectionMap.get(sectionKey)!.questionCount++;

      calculatedTotalMarks += marks;

      if (rowErrors.length > 0) {
        invalidRowCount++;
        rowErrors.forEach((err) => {
          errors.push({
            row: row.rowNumber,
            message: err,
          });
        });
      } else {
        validRowCount++;
      }

      validatedRows.push({
        rowNumber: row.rowNumber,
        isValid: rowErrors.length === 0,
        errors: rowErrors,
        warnings: rowWarnings,
        data: row,
      });
    }

    const sections = Array.from(sectionMap.values());
    const isValid = errors.length === 0;

    return {
      isValid,
      totalRows: rows.length,
      validRows: validRowCount,
      invalidRows: invalidRowCount,
      examCount: 1,
      examCode: examCode || 'EXAM-PAPER',
      examTitle: examTitle || 'Imported Question Paper',
      durationMinutes,
      totalMarks: firstRow.totalMarks || calculatedTotalMarks,
      totalQuestions: rows.length,
      sections,
      errors,
      warnings,
      validatedRows,
    };
  }
}
