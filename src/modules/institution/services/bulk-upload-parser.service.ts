import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import * as path from 'path';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROW_COUNT = 50000;

const REQUIRED_COLUMNS = ['name', 'mobile'];
const OPTIONAL_COLUMNS = [
  'email', 'studentId', 'state', 'district',
  'schoolCollege', 'class', 'examTarget', 'preferredLanguage',
];

@Injectable()
export class BulkUploadParserService {
  private readonly logger = new Logger(BulkUploadParserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate uploaded file metadata (type, size, extension).
   */
  validateFile(file: { originalname: string; size: number; mimetype: string }) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Invalid file type '${ext}'. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      );
    }
  }

  /**
   * Parse uploaded Excel/CSV file and create staging rows.
   * Returns parsed row count.
   */
  async parseAndStage(uploadId: string, fileBuffer: Buffer, fileName: string): Promise<number> {
    const ext = path.extname(fileName).toLowerCase();

    let rows: Record<string, any>[];

    if (ext === '.xlsx') {
      rows = await this.parseXlsx(fileBuffer);
    } else {
      rows = this.parseCsv(fileBuffer);
    }

    if (rows.length === 0) {
      throw new BadRequestException('File contains no data rows.');
    }

    if (rows.length > MAX_ROW_COUNT) {
      throw new BadRequestException(
        `File has ${rows.length} rows, exceeding the maximum of ${MAX_ROW_COUNT}.`,
      );
    }

    // Stage rows in batches of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await this.prisma.bulkUploadRow.createMany({
        data: chunk.map((row, idx) => ({
          uploadId,
          rowNumber: i + idx + 1,
          rawData: row,
          normalizedData: this.normalizeRow(row),
          validationStatus: 'PENDING',
          deduplicationStatus: 'PENDING',
          activationStatus: 'PENDING',
        })),
      });
    }

    // Update upload record
    await this.prisma.bulkUpload.update({
      where: { id: uploadId },
      data: {
        rowCount: rows.length,
        status: 'VALIDATING',
        processedAt: new Date(),
      },
    });

    return rows.length;
  }

  /**
   * Parse XLSX using streaming reader.
   */
  private async parseXlsx(buffer: Buffer): Promise<Record<string, any>[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('Excel file has no worksheets.');
    }

    const headers: string[] = [];
    const rows: Record<string, any>[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        // Header row
        row.eachCell((cell) => {
          headers.push(String(cell.value || '').trim().toLowerCase());
        });
        return;
      }

      const rowData: Record<string, any> = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          rowData[header] = cell.value != null ? String(cell.value).trim() : '';
        }
      });

      // Skip completely empty rows
      if (Object.values(rowData).some((v) => v !== '')) {
        rows.push(rowData);
      }
    });

    return rows;
  }

  /**
   * Parse CSV from buffer.
   */
  private parseCsv(buffer: Buffer): Record<string, any>[] {
    const content = buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');

    if (lines.length < 2) {
      throw new BadRequestException('CSV file must have a header row and at least one data row.');
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
    const rows: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      const rowData: Record<string, any> = {};

      headers.forEach((header, idx) => {
        rowData[header] = (values[idx] || '').trim();
      });

      if (Object.values(rowData).some((v) => v !== '')) {
        rows.push(rowData);
      }
    }

    return rows;
  }

  /**
   * Simple CSV line parser handling quoted values.
   */
  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
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
   * Normalize a raw row into a standard shape.
   */
  private normalizeRow(raw: Record<string, any>): Record<string, any> {
    return {
      name: raw.name || raw['student name'] || raw['full name'] || '',
      mobile: raw.mobile || raw.phone || raw['mobile number'] || raw['phone number'] || '',
      email: raw.email || raw['email address'] || '',
      studentId: raw.studentid || raw['student id'] || raw['roll number'] || raw['roll no'] || '',
      state: raw.state || '',
      district: raw.district || raw.city || '',
      schoolCollege: raw.schoolcollege || raw.school || raw.college || raw['school/college'] || '',
      class: raw.class || raw.grade || '',
      examTarget: raw.examtarget || raw['exam target'] || raw.target || '',
      preferredLanguage: raw.preferredlanguage || raw.language || raw['preferred language'] || '',
    };
  }
}
