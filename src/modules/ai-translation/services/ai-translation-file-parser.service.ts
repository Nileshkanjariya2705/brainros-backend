import { Injectable, BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import {
  AI_TRANSLATION_REQUIRED_HEADERS,
  AI_TRANSLATION_SUPPORTED_EXTENSIONS,
} from '../constants/ai-translation.constants';

export interface RawParsedQuestionRow {
  rowNumber: number;
  questionNumber: number | null;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  rawHeaders: string[];
}

@Injectable()
export class AiTranslationFileParserService {
  /**
   * Parse uploaded question paper buffer (CSV or Excel) into raw row structures
   */
  async parseBuffer(
    buffer: Buffer,
    fileName: string,
  ): Promise<{ rows: RawParsedQuestionRow[]; headers: string[] }> {
    const ext = path.extname(fileName).toLowerCase();

    if (!AI_TRANSLATION_SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Unsupported file type '${ext}'. Supported formats: ${AI_TRANSLATION_SUPPORTED_EXTENSIONS.join(', ')}`,
      );
    }

    if (ext === '.xlsx' || ext === '.xls') {
      return this.parseExcel(buffer);
    } else {
      return this.parseCsv(buffer);
    }
  }

  private async parseExcel(
    buffer: Buffer,
  ): Promise<{ rows: RawParsedQuestionRow[]; headers: string[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new BadRequestException(
        `Failed to parse Excel file: ${err.message || 'Invalid format'}`,
      );
    }

    const worksheet =
      workbook.getWorksheet('QuestionPaper') ||
      workbook.getWorksheet('Questions') ||
      workbook.worksheets[0];

    if (!worksheet) {
      throw new BadRequestException('Excel workbook contains no readable sheets.');
    }

    const headers: string[] = [];
    const rows: RawParsedQuestionRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell, colNumber) => {
          headers[colNumber - 1] = this.normalizeHeader(cell.value);
        });
        return;
      }

      // Check if row has any non-empty cell
      let hasData = false;
      row.eachCell((cell) => {
        if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
          hasData = true;
        }
      });
      if (!hasData) return;

      const rowData: Record<string, string> = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          rowData[header] = this.extractCellValue(cell.value);
        }
      });

      const qNumVal = this.findHeaderValue(rowData, ['question_number', 'q_no', 'qno', 'question_no', 'sr_no', 'id']);
      const qNum = qNumVal && !isNaN(Number(qNumVal)) ? parseInt(qNumVal, 10) : null;

      rows.push({
        rowNumber,
        questionNumber: qNum,
        question: this.findHeaderValue(rowData, ['question', 'question_text', 'question_title']) || '',
        optionA: this.findHeaderValue(rowData, ['option_a', 'optiona', 'a', 'opt_a']) || '',
        optionB: this.findHeaderValue(rowData, ['option_b', 'optionb', 'b', 'opt_b']) || '',
        optionC: this.findHeaderValue(rowData, ['option_c', 'optionc', 'c', 'opt_c']) || '',
        optionD: this.findHeaderValue(rowData, ['option_d', 'optiond', 'd', 'opt_d']) || '',
        rawHeaders: Object.keys(rowData),
      });
    });

    return { rows, headers };
  }

  private async parseCsv(
    buffer: Buffer,
  ): Promise<{ rows: RawParsedQuestionRow[]; headers: string[] }> {
    const content = buffer.toString('utf-8');
    const lines = this.splitCsvLines(content);

    if (lines.length === 0) {
      throw new BadRequestException('CSV file is empty.');
    }

    const rawHeaderLine = lines[0];
    const headers = this.parseCsvRow(rawHeaderLine).map((h) => this.normalizeHeader(h));
    const rows: RawParsedQuestionRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cells = this.parseCsvRow(line);
      const rowData: Record<string, string> = {};

      headers.forEach((h, idx) => {
        if (h) {
          rowData[h] = cells[idx]?.trim() || '';
        }
      });

      const qNumVal = this.findHeaderValue(rowData, ['question_number', 'q_no', 'qno', 'question_no', 'sr_no', 'id']);
      const qNum = qNumVal && !isNaN(Number(qNumVal)) ? parseInt(qNumVal, 10) : null;

      rows.push({
        rowNumber: i + 1,
        questionNumber: qNum,
        question: this.findHeaderValue(rowData, ['question', 'question_text', 'question_title']) || '',
        optionA: this.findHeaderValue(rowData, ['option_a', 'optiona', 'a', 'opt_a']) || '',
        optionB: this.findHeaderValue(rowData, ['option_b', 'optionb', 'b', 'opt_b']) || '',
        optionC: this.findHeaderValue(rowData, ['option_c', 'optionc', 'c', 'opt_c']) || '',
        optionD: this.findHeaderValue(rowData, ['option_d', 'optiond', 'd', 'opt_d']) || '',
        rawHeaders: Object.keys(rowData),
      });
    }

    return { rows, headers };
  }

  private normalizeHeader(val: any): string {
    return String(val || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  private extractCellValue(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      if ('result' in val && val.result !== undefined) return String(val.result).trim();
      if ('text' in val && val.text !== undefined) return String(val.text).trim();
      if ('richText' in val && Array.isArray(val.richText)) {
        return val.richText.map((item: any) => item.text || '').join('').trim();
      }
    }
    return String(val).trim();
  }

  private findHeaderValue(data: Record<string, string>, possibleKeys: string[]): string {
    for (const key of possibleKeys) {
      if (data[key] !== undefined && data[key] !== '') {
        return data[key];
      }
    }
    return '';
  }

  private splitCsvLines(content: string): string[] {
    const lines: string[] = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        currentLine += char;
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && content[i + 1] === '\n') {
          i++;
        }
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
      } else {
        currentLine += char;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine);
    }

    return lines;
  }

  private parseCsvRow(line: string): string[] {
    const result: string[] = [];
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
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }
}
