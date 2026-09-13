import { Injectable } from '@nestjs/common';
import { RawParsedQuestionRow } from './ai-translation-file-parser.service';
import {
  ParsedQuestionRow,
  UploadValidationResponse,
} from '../dto/ai-translation-upload.dto';
import { AI_TRANSLATION_REQUIRED_HEADERS } from '../constants/ai-translation.constants';

@Injectable()
export class AiTranslationValidatorService {
  /**
   * Validate parsed rows and headers against exam metadata
   */
  validate(
    rawRows: RawParsedQuestionRow[],
    headers: string[],
    examContext: {
      examScheduleId: string;
      examId: string;
      examVersionId: string;
      examTitle: string;
      examCode: string;
      totalQuestionsConfigured: number;
      targetLanguages: Array<{ id: string; name: string; code: string }>;
    },
  ): UploadValidationResponse {
    const globalErrors: string[] = [];

    // 1. Header validation
    const normalizedHeaders = headers.map((h) => h.toLowerCase());
    const requiredHeaderGroups = [
      ['question_number', 'q_no', 'qno', 'question_no', 'sr_no', 'id'],
      ['question', 'question_text', 'question_title'],
      ['option_a', 'optiona', 'a', 'opt_a'],
      ['option_b', 'optionb', 'b', 'opt_b'],
      ['option_c', 'optionc', 'c', 'opt_c'],
      ['option_d', 'optiond', 'd', 'opt_d'],
    ];

    for (const group of requiredHeaderGroups) {
      const hasMatch = group.some((key) => normalizedHeaders.includes(key));
      if (!hasMatch) {
        globalErrors.push(
          `Missing required column: one of [${group.join(', ')}] was not found in the header row.`,
        );
      }
    }

    if (rawRows.length === 0) {
      globalErrors.push('The uploaded file contains no question rows.');
    }

    // 2. Row level validations
    const seenQuestionNumbers = new Set<number>();
    const seenQuestionTexts = new Set<string>();
    const validatedRows: ParsedQuestionRow[] = [];

    rawRows.forEach((row, idx) => {
      const rowErrors: string[] = [];
      const assignedQNum = row.questionNumber ?? idx + 1;

      // Question Number check
      if (row.questionNumber === null || isNaN(row.questionNumber) || row.questionNumber <= 0) {
        rowErrors.push('Invalid or missing Question Number.');
      } else if (seenQuestionNumbers.has(row.questionNumber)) {
        rowErrors.push(`Duplicate Question Number: ${row.questionNumber}.`);
      } else {
        seenQuestionNumbers.add(row.questionNumber);
      }

      // Question Text check
      const trimmedQ = (row.question || '').trim();
      if (!trimmedQ) {
        rowErrors.push('Question text cannot be empty.');
      } else if (trimmedQ.length < 3) {
        rowErrors.push('Question text is too short (minimum 3 characters).');
      } else {
        const normQ = trimmedQ.toLowerCase();
        if (seenQuestionTexts.has(normQ)) {
          rowErrors.push('Duplicate question text found in another row.');
        } else {
          seenQuestionTexts.add(normQ);
        }
      }

      // Options check
      const optA = (row.optionA || '').trim();
      const optB = (row.optionB || '').trim();
      const optC = (row.optionC || '').trim();
      const optD = (row.optionD || '').trim();

      if (!optA) rowErrors.push('Option A cannot be empty.');
      if (!optB) rowErrors.push('Option B cannot be empty.');
      if (!optC) rowErrors.push('Option C cannot be empty.');
      if (!optD) rowErrors.push('Option D cannot be empty.');

      // Check unique options for this question
      const filledOptions = [optA, optB, optC, optD].filter(Boolean);
      const uniqueOptions = new Set(filledOptions.map((o) => o.toLowerCase()));
      if (filledOptions.length === 4 && uniqueOptions.size < 4) {
        rowErrors.push('All 4 options (A, B, C, D) must have distinct values.');
      }

      validatedRows.push({
        rowNumber: row.rowNumber,
        questionNumber: assignedQNum,
        question: trimmedQ,
        optionA: optA,
        optionB: optB,
        optionC: optC,
        optionD: optD,
        isValid: rowErrors.length === 0,
        errors: rowErrors,
      });
    });

    // 3. Question Count matching
    const validRowsCount = validatedRows.filter((r) => r.isValid).length;
    const invalidRowsCount = validatedRows.length - validRowsCount;

    if (
      examContext.totalQuestionsConfigured > 0 &&
      validatedRows.length !== examContext.totalQuestionsConfigured
    ) {
      globalErrors.push(
        `Total rows in file (${validatedRows.length}) does not match exam configuration (${examContext.totalQuestionsConfigured} questions expected).`,
      );
    }

    const isValid = globalErrors.length === 0 && invalidRowsCount === 0;

    return {
      isValid,
      totalRows: validatedRows.length,
      validRowsCount,
      invalidRowsCount,
      expectedQuestionsCount: examContext.totalQuestionsConfigured,
      examTitle: examContext.examTitle,
      examCode: examContext.examCode,
      examScheduleId: examContext.examScheduleId,
      examId: examContext.examId,
      examVersionId: examContext.examVersionId,
      targetLanguages: examContext.targetLanguages,
      rows: validatedRows,
      globalErrors,
    };
  }
}
