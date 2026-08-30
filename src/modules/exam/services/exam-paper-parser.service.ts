import { Injectable, BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { ParsedExamPaperRow } from '../dto/exam-manager.dto';

@Injectable()
export class ExamPaperParserService {
  /**
   * Parse uploaded question paper buffer into parsed rows
   */
  async parseBuffer(
    buffer: Buffer,
    fileName: string,
  ): Promise<ParsedExamPaperRow[]> {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.xlsx' || ext === '.xls') {
      return this.parseExcel(buffer);
    } else if (ext === '.csv') {
      return this.parseCsv(buffer);
    } else {
      throw new BadRequestException(
        `Unsupported file type '${ext}'. Please upload a valid .csv, .xlsx, or .xls question paper.`,
      );
    }
  }

  private async parseExcel(buffer: Buffer): Promise<ParsedExamPaperRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet =
      workbook.getWorksheet('QuestionPaper') ||
      workbook.getWorksheet('ExamPaper') ||
      workbook.worksheets[0];

    if (!worksheet) {
      throw new BadRequestException('Excel workbook contains no sheets.');
    }

    const headers: string[] = [];
    const rows: ParsedExamPaperRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell, colNumber) => {
          headers[colNumber - 1] = String(cell.value || '')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
        });
        return;
      }

      const rawData: Record<string, any> = {};
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
          rawData[header] = val != null ? String(val).trim() : '';
        }
      });

      if (Object.values(rawData).some((v) => v !== '')) {
        rows.push(this.mapRawToParsedRow(rawData, rowNumber));
      }
    });

    if (rows.length === 0) {
      throw new BadRequestException('Question paper contains no data rows.');
    }

    return rows;
  }

  private parseCsv(buffer: Buffer): ParsedExamPaperRow[] {
    const content = buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) {
      throw new BadRequestException(
        'CSV file must contain a header and at least one question row.',
      );
    }

    const headers = this.parseCsvLine(lines[0]).map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[\s-]+/g, '_'),
    );

    const rows: ParsedExamPaperRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const values = this.parseCsvLine(line);
      const rawData: Record<string, any> = {};

      headers.forEach((header, idx) => {
        rawData[header] = values[idx] != null ? values[idx].trim() : '';
      });

      if (Object.values(rawData).some((v) => v !== '')) {
        rows.push(this.mapRawToParsedRow(rawData, i + 1));
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException('Question paper contains no data rows.');
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

  private mapRawToParsedRow(
    raw: Record<string, any>,
    rowNumber: number,
  ): ParsedExamPaperRow {
    return {
      rowNumber,
      examCode: raw.exam_code || raw.examcode || raw.code || '',
      examName:
        raw.exam_name ||
        raw.examname ||
        raw.exam_title ||
        raw.title ||
        'Imported Question Paper Exam',
      examDescription:
        raw.exam_description || raw.description || raw.instructions || '',
      examTarget: raw.exam_target || raw.target || 'NEET',
      durationMinutes: raw.duration_minutes
        ? parseInt(raw.duration_minutes, 10)
        : raw.duration
        ? parseInt(raw.duration, 10)
        : 200,
      totalMarks: raw.total_marks ? parseFloat(raw.total_marks) : undefined,
      subject: raw.subject || raw.subject_name || '',
      sectionName: raw.section_name || raw.section || '',
      chapter: raw.chapter || raw.chapter_name || '',
      topic: raw.topic || raw.topic_name || '',
      questionNumber: raw.question_number
        ? parseInt(raw.question_number, 10)
        : rowNumber - 1,
      questionType: (
        raw.question_type ||
        raw.type ||
        'SINGLE_CORRECT'
      ).toUpperCase(),
      questionText:
        raw.question_text || raw.question || raw.text || raw.statement || '',
      passageText: raw.passage_text || raw.passage || '',
      assertionText: raw.assertion_text || raw.assertion || '',
      reasonText: raw.reason_text || raw.reason || '',
      optionA: raw.option_a || raw.optiona || raw.a || '',
      optionB: raw.option_b || raw.optionb || raw.b || '',
      optionC: raw.option_c || raw.optionc || raw.c || '',
      optionD: raw.option_d || raw.optiond || raw.d || '',
      optionE: raw.option_e || raw.optione || raw.e || '',
      optionF: raw.option_f || raw.optionf || raw.f || '',
      correctAnswer: (
        raw.correct_answer ||
        raw.correctanswer ||
        raw.answer ||
        raw.correct_option ||
        ''
      ).trim(),
      marks: raw.marks ? parseFloat(raw.marks) : 4.0,
      negativeMarks: raw.negative_marks
        ? parseFloat(raw.negative_marks)
        : raw.negativemarks
        ? parseFloat(raw.negativemarks)
        : 1.0,
      difficulty: (raw.difficulty || raw.difficulty_level || 'MEDIUM').toUpperCase(),
      explanation: raw.explanation || raw.solution || '',
      language: (raw.language || raw.language_code || 'en').toLowerCase(),
    };
  }
}
