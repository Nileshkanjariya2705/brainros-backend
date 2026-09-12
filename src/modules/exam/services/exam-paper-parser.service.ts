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
    const getVal = (aliases: string[]): string => {
      for (const alias of aliases) {
        if (
          raw[alias] !== undefined &&
          raw[alias] !== null &&
          String(raw[alias]).trim() !== ''
        ) {
          return String(raw[alias]).trim();
        }
      }
      return '';
    };

    const qNumStr = getVal([
      'question_number',
      'question_num',
      'q_num',
      'qn',
      'questionnumber',
      'q_number',
      'number',
      'sr_no',
      's_no',
      'no',
      '#',
    ]);

    const questionText = getVal([
      'question',
      'question_text',
      'questiontext',
      'q_text',
      'q_statement',
      'statement',
      'text',
    ]);

    const optionA = getVal(['option_a', 'optiona', 'opt_a', 'op_a', 'a', 'option_1']);
    const optionB = getVal(['option_b', 'optionb', 'opt_b', 'op_b', 'b', 'option_2']);
    const optionC = getVal(['option_c', 'optionc', 'opt_c', 'op_c', 'c', 'option_3']);
    const optionD = getVal(['option_d', 'optiond', 'opt_d', 'op_d', 'd', 'option_4']);

    return {
      rowNumber,
      questionNumber: qNumStr ? parseInt(qNumStr, 10) : rowNumber - 1,
      questionText,
      optionA,
      optionB,
      optionC,
      optionD,
      optionE: getVal(['option_e', 'optione', 'e']),
      optionF: getVal(['option_f', 'optionf', 'f']),
      examCode: getVal(['exam_code', 'examcode', 'code']) || 'EXAM-PAPER',
      examName: getVal(['exam_name', 'examname', 'title']) || 'Imported Question Paper',
      examDescription: getVal(['exam_description', 'description']) || '',
      examTarget: getVal(['exam_target', 'target']) || 'NEET',
      durationMinutes: getVal(['duration_minutes', 'duration'])
        ? parseInt(getVal(['duration_minutes', 'duration']), 10)
        : 200,
      totalMarks: getVal(['total_marks']) ? parseFloat(getVal(['total_marks'])) : undefined,
      subject: getVal(['subject', 'subject_name']) || 'General',
      sectionName: getVal(['section_name', 'section']) || '',
      chapter: getVal(['chapter', 'chapter_name']) || '',
      topic: getVal(['topic', 'topic_name']) || '',
      questionType: (getVal(['question_type', 'type']) || 'SINGLE_CORRECT').toUpperCase(),
      passageText: getVal(['passage_text', 'passage']) || undefined,
      assertionText: getVal(['assertion_text', 'assertion']) || undefined,
      reasonText: getVal(['reason_text', 'reason']) || undefined,
      correctAnswer: getVal(['correct_answer', 'correctanswer', 'answer']).toUpperCase(),
      marks: getVal(['marks']) ? parseFloat(getVal(['marks'])) : 4.0,
      negativeMarks: getVal(['negative_marks', 'negativemarks'])
        ? parseFloat(getVal(['negative_marks', 'negativemarks']))
        : 1.0,
      difficulty: (getVal(['difficulty', 'difficulty_level']) || 'MEDIUM').toUpperCase(),
      explanation: getVal(['explanation', 'solution']) || undefined,
      language: (getVal(['language', 'language_code']) || 'en').toLowerCase(),
    };
  }
}
