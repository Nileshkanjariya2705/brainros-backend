import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { OtpService } from '../../auth/services/otp.service';
import * as ExcelJS from 'exceljs';
import * as path from 'path';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROW_COUNT = 10000;

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class StudentBulkRegistrationService {
  private readonly logger = new Logger(StudentBulkRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService,
    private readonly otpService: OtpService,
  ) {}

  /**
   * Validate uploaded file type, extension, and size
   */
  validateFile(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException(
        `Invalid file format '${ext}'. Supported formats: CSV, XLSX, XLS.`,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds maximum limit of 10MB.`,
      );
    }
  }

  /**
   * Generates a sample CSV or Excel template for bulk student registration
   */
  async generateTemplate(format: 'csv' | 'xlsx' = 'xlsx'): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Brainros Exam Management System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Students', {
      views: [{ showGridLines: true }],
    });

    const headers = [
      { header: 'Full Name *', key: 'name', width: 25 },
      { header: 'Mobile Number * (10 Digits)', key: 'mobile', width: 22 },
      { header: 'Email Address (Optional)', key: 'email', width: 28 },
      { header: 'State *', key: 'state', width: 20 },
      { header: 'City / District *', key: 'city', width: 22 },
      { header: 'Class / Grade * (e.g. 11th, 12th, Dropper)', key: 'class', width: 25 },
      { header: 'Exam Target * (e.g. NEET, JEE_MAIN)', key: 'examTarget', width: 24 },
      { header: 'Preferred Language * (e.g. ENGLISH, HINDI, GUJARATI)', key: 'preferredLanguage', width: 26 },
      { header: 'School / College / Institution *', key: 'schoolCollege', width: 32 },
    ];

    sheet.columns = headers;

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' }, // Dark slate
      };
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Sample data rows
    const sampleRows = [
      {
        name: 'Rahul Sharma',
        mobile: '9876543210',
        email: 'rahul.sharma@example.com',
        state: 'Gujarat',
        city: 'Ahmedabad',
        class: '12th',
        examTarget: 'NEET',
        preferredLanguage: 'ENGLISH',
        schoolCollege: 'Delhi Public School',
      },
      {
        name: 'Priya Patel',
        mobile: '9876543211',
        email: 'priya.patel@example.com',
        state: 'Gujarat',
        city: 'Surat',
        class: '11th',
        examTarget: 'JEE_MAIN',
        preferredLanguage: 'GUJARATI',
        schoolCollege: 'St. Xavier High School',
      },
      {
        name: 'Amit Verma',
        mobile: '9876543212',
        email: 'amit.verma@example.com',
        state: 'Maharashtra',
        city: 'Mumbai',
        class: '12th',
        examTarget: 'NEET',
        preferredLanguage: 'HINDI',
        schoolCollege: 'Kendriya Vidyalaya',
      },
    ];

    sampleRows.forEach((row) => sheet.addRow(row));

    // Style data rows
    for (let r = 2; r <= 4; r++) {
      const row = sheet.getRow(r);
      row.height = 22;
      row.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
    }

    if (format === 'csv') {
      const buffer = (await workbook.csv.writeBuffer()) as unknown as Buffer;
      return {
        buffer: Buffer.from(buffer),
        fileName: 'student_bulk_registration_template.csv',
        mimeType: 'text/csv',
      };
    } else {
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
      return {
        buffer: Buffer.from(buffer),
        fileName: 'student_bulk_registration_template.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
  }

  /**
   * Parses raw file buffer into structured rows
   */
  private async parseSpreadsheet(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<Record<string, string>[]> {
    const ext = path.extname(fileName).toLowerCase();
    const rows: Record<string, string>[] = [];

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer as any);
      const sheet = workbook.worksheets[0];

      if (!sheet || sheet.rowCount < 2) {
        throw new BadRequestException('Uploaded spreadsheet contains no data rows.');
      }

      // Read header mapping
      const headerMap = new Map<number, string>();
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const val = String(cell.value || '').trim().toLowerCase();
        if (val.includes('name') && !val.includes('state') && !val.includes('school')) headerMap.set(colNumber, 'name');
        else if (val.includes('mobile') || val.includes('phone')) headerMap.set(colNumber, 'mobile');
        else if (val.includes('email')) headerMap.set(colNumber, 'email');
        else if (val.includes('state')) headerMap.set(colNumber, 'state');
        else if (val.includes('city') || val.includes('district')) headerMap.set(colNumber, 'city');
        else if (val.includes('class') || val.includes('grade')) headerMap.set(colNumber, 'class');
        else if (val.includes('target') || val.includes('exam')) headerMap.set(colNumber, 'examTarget');
        else if (val.includes('lang')) headerMap.set(colNumber, 'preferredLanguage');
        else if (val.includes('school') || val.includes('college') || val.includes('institution')) headerMap.set(colNumber, 'schoolCollege');
      });

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header

        const record: Record<string, string> = {};
        let hasValues = false;

        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const key = headerMap.get(colNumber);
          if (key) {
            let strVal = '';
            if (typeof cell.value === 'object' && cell.value !== null) {
              strVal = String((cell.value as any).text || (cell.value as any).result || '');
            } else {
              strVal = String(cell.value ?? '').trim();
            }
            if (strVal) {
              hasValues = true;
              record[key] = strVal;
            }
          }
        });

        if (hasValues) {
          rows.push(record);
        }
      });
    } else {
      // CSV parsing
      const text = fileBuffer.toString('utf-8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        throw new BadRequestException('Uploaded CSV contains no data rows.');
      }

      const parseCsvLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result.map((s) => s.replace(/^"|"$/g, '').trim());
      };

      const headerCols = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const headerMap = new Map<number, string>();
      headerCols.forEach((val, idx) => {
        if (val.includes('name') && !val.includes('state') && !val.includes('school')) headerMap.set(idx, 'name');
        else if (val.includes('mobile') || val.includes('phone')) headerMap.set(idx, 'mobile');
        else if (val.includes('email')) headerMap.set(idx, 'email');
        else if (val.includes('state')) headerMap.set(idx, 'state');
        else if (val.includes('city') || val.includes('district')) headerMap.set(idx, 'city');
        else if (val.includes('class') || val.includes('grade')) headerMap.set(idx, 'class');
        else if (val.includes('target') || val.includes('exam')) headerMap.set(idx, 'examTarget');
        else if (val.includes('lang')) headerMap.set(idx, 'preferredLanguage');
        else if (val.includes('school') || val.includes('college') || val.includes('institution')) headerMap.set(idx, 'schoolCollege');
      });

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const record: Record<string, string> = {};
        let hasValues = false;
        cols.forEach((val, colIdx) => {
          const key = headerMap.get(colIdx);
          if (key && val) {
            hasValues = true;
            record[key] = val;
          }
        });
        if (hasValues) {
          rows.push(record);
        }
      }
    }

    return rows;
  }

  /**
   * Upload, stage, and validate spreadsheet rows for Super Admin
   */
  async uploadAndValidate(
    file: Express.Multer.File,
    actor: { userId: string; email?: string },
  ) {
    this.validateFile(file);

    const rows = await this.parseSpreadsheet(file.buffer, file.originalname);
    if (rows.length === 0) {
      throw new BadRequestException('File contains no readable student rows.');
    }
    if (rows.length > MAX_ROW_COUNT) {
      throw new BadRequestException(
        `File contains ${rows.length} rows, which exceeds the maximum limit of ${MAX_ROW_COUNT} rows per upload.`,
      );
    }

    const ext = path.extname(file.originalname).toLowerCase().replace('.', '').toUpperCase();

    // 1. Create BulkUpload staging record
    const bulkUpload = await this.prisma.bulkUpload.create({
      data: {
        uploadType: 'SUPER_ADMIN_STUDENTS',
        fileName: file.originalname,
        fileType: ext,
        fileSize: file.size,
        rowCount: rows.length,
        status: 'VALIDATING',
        uploadedById: actor.userId,
      },
    });

    // 2. Load Master Data for O(1) in-memory resolution & validation
    const [states, districts, classes, examTargets, languages] = await Promise.all([
      this.prisma.state.findMany({ where: { isActive: true } }),
      this.prisma.district.findMany({ where: { isActive: true } }),
      this.prisma.studentClass.findMany(),
      this.prisma.examTarget.findMany(),
      this.prisma.preferredLanguage.findMany({ where: { isActive: true } }),
    ]);

    // Lookup Maps
    const stateMap = new Map<string, typeof states[0]>();
    states.forEach((s) => {
      stateMap.set(s.name.toLowerCase().trim(), s);
      stateMap.set(s.code.toLowerCase().trim(), s);
    });

    const districtMap = new Map<string, typeof districts[0]>();
    districts.forEach((d) => {
      districtMap.set(`${d.name.toLowerCase().trim()}_${d.stateId}`, d);
      districtMap.set(d.name.toLowerCase().trim(), d); // fallback
    });

    const classMap = new Map<string, typeof classes[0]>();
    classes.forEach((c) => {
      classMap.set(c.name.toLowerCase().trim(), c);
      classMap.set(c.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(), c);
    });

    const examTargetMap = new Map<string, typeof examTargets[0]>();
    examTargets.forEach((et) => {
      examTargetMap.set(et.name.toLowerCase().trim(), et);
      examTargetMap.set(et.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(), et);
    });

    const languageMap = new Map<string, typeof languages[0]>();
    languages.forEach((l) => {
      languageMap.set(l.name.toLowerCase().trim(), l);
      if (l.code) languageMap.set(l.code.toLowerCase().trim(), l);
    });

    // 3. Batch query DB for existing users with any of the mobiles or emails
    const fileMobiles: string[] = [];
    const fileEmails: string[] = [];
    rows.forEach((r) => {
      if (r.mobile) {
        const cleanMob = r.mobile.replace(/\D/g, '');
        const norm = cleanMob.length === 10 ? `+91${cleanMob}` : cleanMob.startsWith('91') ? `+${cleanMob}` : cleanMob;
        fileMobiles.push(norm);
        if (cleanMob.length === 10) fileMobiles.push(cleanMob);
      }
      if (r.email) {
        fileEmails.push(r.email.toLowerCase().trim());
      }
    });

    const existingUsers = await this.prisma.user.findMany({
      where: {
        OR: [
          { mobileNumber: { in: fileMobiles } },
          { phone: { in: fileMobiles } },
          ...(fileEmails.length > 0 ? [{ email: { in: fileEmails } }] : []),
        ],
      },
      select: { id: true, mobileNumber: true, phone: true, email: true },
    });

    const existingMobileSet = new Set<string>();
    const existingEmailSet = new Set<string>();
    existingUsers.forEach((u) => {
      if (u.mobileNumber) existingMobileSet.add(u.mobileNumber.replace(/\D/g, ''));
      if (u.phone) existingMobileSet.add(u.phone.replace(/\D/g, ''));
      if (u.email) existingEmailSet.add(u.email.toLowerCase().trim());
    });

    // 4. Validate each row & track in-file duplicates
    const mobilesSeen = new Map<string, number>();
    const emailsSeen = new Map<string, number>();

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    const stagedRowsData: any[] = [];
    const allErrorsData: any[] = [];

    rows.forEach((raw, idx) => {
      const rowNumber = idx + 1;
      const rowErrors: { field: string; errorCode: string; message: string }[] = [];

      const name = (raw.name || '').trim();
      const rawMobile = (raw.mobile || '').replace(/\D/g, '');
      const email = raw.email ? raw.email.toLowerCase().trim() : null;
      const stateName = (raw.state || '').trim();
      const cityName = (raw.city || '').trim();
      const className = (raw.class || '').trim();
      const examTargetName = (raw.examTarget || '').trim();
      const languageName = (raw.preferredLanguage || '').trim();
      const schoolCollege = (raw.schoolCollege || '').trim();

      // Field Validations
      if (!name || name.length < 2) {
        rowErrors.push({
          field: 'name',
          errorCode: 'INVALID_NAME',
          message: 'Student name is required (minimum 2 characters).',
        });
      }

      if (!rawMobile) {
        rowErrors.push({
          field: 'mobile',
          errorCode: 'MISSING_MOBILE',
          message: 'Mobile number is required.',
        });
      } else {
        const standardMobile = rawMobile.length === 10 ? rawMobile : rawMobile.startsWith('91') && rawMobile.length === 12 ? rawMobile.substring(2) : rawMobile;
        if (!MOBILE_REGEX.test(standardMobile)) {
          rowErrors.push({
            field: 'mobile',
            errorCode: 'INVALID_MOBILE_FORMAT',
            message: `Invalid mobile number '${raw.mobile}'. Must be a valid 10-digit Indian number starting with 6-9.`,
          });
        }
      }

      if (email && !EMAIL_REGEX.test(email)) {
        rowErrors.push({
          field: 'email',
          errorCode: 'INVALID_EMAIL_FORMAT',
          message: `Invalid email address format '${email}'.`,
        });
      }

      // Master Data Validations
      let resolvedStateId: string | null = null;
      let resolvedDistrictId: string | null = null;
      let resolvedClassId: string | null = null;
      let resolvedExamTargetId: string | null = null;
      let resolvedLanguageId: string | null = null;

      // State
      if (!stateName) {
        rowErrors.push({
          field: 'state',
          errorCode: 'MISSING_STATE',
          message: 'State is required.',
        });
      } else {
        const stateRecord = stateMap.get(stateName.toLowerCase());
        if (!stateRecord) {
          rowErrors.push({
            field: 'state',
            errorCode: 'UNKNOWN_STATE',
            message: `State '${stateName}' is not recognized in active master records.`,
          });
        } else {
          resolvedStateId = stateRecord.id;
        }
      }

      // City / District
      if (!cityName) {
        rowErrors.push({
          field: 'city',
          errorCode: 'MISSING_CITY',
          message: 'City / District is required.',
        });
      } else if (resolvedStateId) {
        const districtKey = `${cityName.toLowerCase()}_${resolvedStateId}`;
        const districtRecord = districtMap.get(districtKey) || districtMap.get(cityName.toLowerCase());
        if (!districtRecord) {
          rowErrors.push({
            field: 'city',
            errorCode: 'UNKNOWN_CITY',
            message: `City/District '${cityName}' not found in master records.`,
          });
        } else if (districtRecord.stateId !== resolvedStateId) {
          rowErrors.push({
            field: 'city',
            errorCode: 'CITY_STATE_MISMATCH',
            message: `City '${cityName}' does not belong to State '${stateName}'.`,
          });
        } else {
          resolvedDistrictId = districtRecord.id;
        }
      }

      // Class
      if (!className) {
        rowErrors.push({
          field: 'class',
          errorCode: 'MISSING_CLASS',
          message: 'Class / Grade is required.',
        });
      } else {
        const classRecord = classMap.get(className.toLowerCase()) || classMap.get(className.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
        if (!classRecord) {
          rowErrors.push({
            field: 'class',
            errorCode: 'UNKNOWN_CLASS',
            message: `Class '${className}' is not a valid academic class.`,
          });
        } else if (classRecord.name === 'FOUNDATION') {
          rowErrors.push({
            field: 'class',
            errorCode: 'DEPRECATED_CLASS',
            message: 'Class FOUNDATION is no longer available.',
          });
        } else {
          resolvedClassId = classRecord.id;
        }
      }

      // Exam Target
      if (!examTargetName) {
        rowErrors.push({
          field: 'examTarget',
          errorCode: 'MISSING_EXAM_TARGET',
          message: 'Exam Target is required (e.g. NEET, JEE_MAIN).',
        });
      } else {
        const examRecord = examTargetMap.get(examTargetName.toLowerCase()) || examTargetMap.get(examTargetName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
        if (!examRecord) {
          rowErrors.push({
            field: 'examTarget',
            errorCode: 'UNKNOWN_EXAM_TARGET',
            message: `Exam target '${examTargetName}' is not recognized.`,
          });
        } else {
          resolvedExamTargetId = examRecord.id;
        }
      }

      // Preferred Language
      if (!languageName) {
        rowErrors.push({
          field: 'preferredLanguage',
          errorCode: 'MISSING_LANGUAGE',
          message: 'Preferred Language is required (e.g. ENGLISH, HINDI, GUJARATI).',
        });
      } else {
        const langRecord = languageMap.get(languageName.toLowerCase());
        if (!langRecord) {
          rowErrors.push({
            field: 'preferredLanguage',
            errorCode: 'UNKNOWN_LANGUAGE',
            message: `Language '${languageName}' is not supported.`,
          });
        } else {
          resolvedLanguageId = langRecord.id;
        }
      }

      // School / College
      if (!schoolCollege) {
        rowErrors.push({
          field: 'schoolCollege',
          errorCode: 'MISSING_SCHOOL_COLLEGE',
          message: 'School / College / Institution name is required.',
        });
      }

      // Deduplication checks
      let dedupStatus = 'UNIQUE';
      const standardMobile = rawMobile.length === 10 ? rawMobile : rawMobile.startsWith('91') && rawMobile.length === 12 ? rawMobile.substring(2) : rawMobile;

      if (standardMobile) {
        // In-file duplicate check
        if (mobilesSeen.has(standardMobile)) {
          dedupStatus = 'DUPLICATE_IN_FILE';
          rowErrors.push({
            field: 'mobile',
            errorCode: 'DUPLICATE_MOBILE_IN_FILE',
            message: `Mobile number '${standardMobile}' already appears on row ${mobilesSeen.get(standardMobile)}.`,
          });
        } else {
          mobilesSeen.set(standardMobile, rowNumber);
        }

        // Database duplicate check
        if (existingMobileSet.has(standardMobile)) {
          dedupStatus = 'EXISTING_STUDENT';
          rowErrors.push({
            field: 'mobile',
            errorCode: 'MOBILE_ALREADY_REGISTERED',
            message: `A user with mobile number '${standardMobile}' is already registered in the system.`,
          });
        }
      }

      if (email) {
        if (emailsSeen.has(email)) {
          dedupStatus = 'DUPLICATE_IN_FILE';
          rowErrors.push({
            field: 'email',
            errorCode: 'DUPLICATE_EMAIL_IN_FILE',
            message: `Email '${email}' already appears on row ${emailsSeen.get(email)}.`,
          });
        } else {
          emailsSeen.set(email, rowNumber);
        }

        if (existingEmailSet.has(email)) {
          dedupStatus = 'EXISTING_STUDENT';
          rowErrors.push({
            field: 'email',
            errorCode: 'EMAIL_ALREADY_REGISTERED',
            message: `A user with email '${email}' is already registered in the system.`,
          });
        }
      }

      const isValid = rowErrors.length === 0;
      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
        if (dedupStatus !== 'UNIQUE') {
          duplicateCount++;
        }
      }

      const normalizedMobile = standardMobile.length === 10 ? `+91${standardMobile}` : standardMobile;

      const normalizedData = {
        name,
        mobile: normalizedMobile,
        rawMobile: standardMobile,
        email,
        state: stateName,
        city: cityName,
        stateId: resolvedStateId,
        districtId: resolvedDistrictId,
        class: className,
        classId: resolvedClassId,
        examTarget: examTargetName,
        examTargetId: resolvedExamTargetId,
        preferredLanguage: languageName,
        preferredLanguageId: resolvedLanguageId,
        schoolCollege,
      };

      stagedRowsData.push({
        uploadId: bulkUpload.id,
        rowNumber,
        rawData: raw,
        normalizedData,
        validationStatus: isValid ? 'VALID' : 'INVALID',
        deduplicationStatus: dedupStatus,
        errorCount: rowErrors.length,
        activationStatus: 'PENDING',
        errors: rowErrors,
      });
    });

    // 5. Save staged rows and errors in DB
    for (const stagedRow of stagedRowsData) {
      const createdRow = await this.prisma.bulkUploadRow.create({
        data: {
          uploadId: stagedRow.uploadId,
          rowNumber: stagedRow.rowNumber,
          rawData: stagedRow.rawData,
          normalizedData: stagedRow.normalizedData,
          validationStatus: stagedRow.validationStatus,
          deduplicationStatus: stagedRow.deduplicationStatus,
          errorCount: stagedRow.errorCount,
          activationStatus: stagedRow.activationStatus,
        },
      });

      if (stagedRow.errors && stagedRow.errors.length > 0) {
        for (const err of stagedRow.errors) {
          allErrorsData.push({
            uploadId: bulkUpload.id,
            rowId: createdRow.id,
            rowNumber: stagedRow.rowNumber,
            field: err.field,
            errorCode: err.errorCode,
            message: err.message,
          });
        }
      }
    }

    if (allErrorsData.length > 0) {
      await this.prisma.bulkUploadError.createMany({
        data: allErrorsData,
      });
    }

    // 6. Update BulkUpload summary record
    const updatedUpload = await this.prisma.bulkUpload.update({
      where: { id: bulkUpload.id },
      data: {
        validRowCount: validCount,
        invalidRowCount: invalidCount,
        duplicateRowCount: duplicateCount,
        status: validCount > 0 ? 'READY_FOR_REVIEW' : 'FAILED',
        processedAt: new Date(),
      },
      include: {
        _count: {
          select: { rows: true, errors: true },
        },
      },
    });

    await this.securityEventService.log('STUDENT_BULK_UPLOAD_VALIDATED' as any, {
      userId: actor.userId,
      metadata: {
        uploadId: bulkUpload.id,
        total: rows.length,
        valid: validCount,
        invalid: invalidCount,
        duplicates: duplicateCount,
      },
    });

    return {
      uploadId: updatedUpload.id,
      fileName: updatedUpload.fileName,
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      duplicateRows: duplicateCount,
      status: updatedUpload.status,
      message:
        validCount > 0
          ? `Validation complete: ${validCount} valid rows ready for registration, ${invalidCount} invalid rows.`
          : `Validation failed: All ${invalidCount} rows contain errors.`,
    };
  }

  /**
   * Retrieves preview of an uploaded batch with paginated rows and row-level errors
   */
  async getUploadPreview(
    uploadId: string,
    page = 1,
    limit = 20,
    filterStatus?: 'ALL' | 'VALID' | 'INVALID',
  ) {
    const upload = await this.prisma.bulkUpload.findUnique({
      where: { id: uploadId },
      include: {
        errors: {
          take: 50,
          orderBy: { rowNumber: 'asc' },
        },
      },
    });

    if (!upload) {
      throw new NotFoundException(`Bulk upload session '${uploadId}' not found.`);
    }

    const whereClause: any = { uploadId };
    if (filterStatus === 'VALID') whereClause.validationStatus = 'VALID';
    if (filterStatus === 'INVALID') whereClause.validationStatus = 'INVALID';

    const [rows, totalFilteredRows] = await Promise.all([
      this.prisma.bulkUploadRow.findMany({
        where: whereClause,
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          errors: true,
        },
      }),
      this.prisma.bulkUploadRow.count({ where: whereClause }),
    ]);

    return {
      upload: {
        id: upload.id,
        fileName: upload.fileName,
        fileType: upload.fileType,
        rowCount: upload.rowCount,
        validRowCount: upload.validRowCount,
        invalidRowCount: upload.invalidRowCount,
        duplicateRowCount: upload.duplicateRowCount,
        activatedCount: upload.activatedCount,
        failedCount: upload.failedCount,
        status: upload.status,
        createdAt: upload.createdAt,
        processedAt: upload.processedAt,
        activatedAt: upload.activatedAt,
      },
      pagination: {
        page,
        limit,
        total: totalFilteredRows,
        totalPages: Math.ceil(totalFilteredRows / limit),
      },
      rows: rows.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        data: r.normalizedData || r.rawData,
        validationStatus: r.validationStatus,
        deduplicationStatus: r.deduplicationStatus,
        activationStatus: r.activationStatus,
        activationError: r.activationError,
        matchedStudentId: r.matchedStudentId,
        errors: r.errors.map((e) => ({
          field: e.field,
          errorCode: e.errorCode,
          message: e.message,
        })),
      })),
    };
  }

  /**
   * Retrieves list of Super Admin bulk student uploads history
   */
  async getUploadHistory(page = 1, limit = 20, status?: string) {
    const where: any = { uploadType: 'SUPER_ADMIN_STUDENTS' };
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const [uploads, total] = await Promise.all([
      this.prisma.bulkUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bulkUpload.count({ where }),
    ]);

    return {
      uploads: uploads.map((u) => ({
        id: u.id,
        fileName: u.fileName,
        fileType: u.fileType,
        fileSize: u.fileSize,
        rowCount: u.rowCount,
        validRowCount: u.validRowCount,
        invalidRowCount: u.invalidRowCount,
        duplicateRowCount: u.duplicateRowCount,
        activatedCount: u.activatedCount,
        failedCount: u.failedCount,
        status: u.status,
        createdAt: u.createdAt,
        activatedAt: u.activatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Confirms registration and executes transactional batch creation for valid rows
   */
  async confirmAndRegisterStudents(
    uploadId: string,
    actor: { userId: string; email?: string },
  ) {
    const upload = await this.prisma.bulkUpload.findUnique({
      where: { id: uploadId },
    });

    if (!upload) {
      throw new NotFoundException(`Upload batch '${uploadId}' not found.`);
    }

    if (upload.status !== 'READY_FOR_REVIEW' && upload.status !== 'UPLOADED') {
      throw new BadRequestException(
        `Upload batch is in '${upload.status}' state and cannot be registered. Expected READY_FOR_REVIEW.`,
      );
    }

    if (upload.validRowCount === 0) {
      throw new BadRequestException('This batch has 0 valid rows to register.');
    }

    // Set status to ACTIVATING
    await this.prisma.bulkUpload.update({
      where: { id: uploadId },
      data: { status: 'ACTIVATING' },
    });

    // Execute bulk registration synchronously in controlled transactional batches
    return this.executeBulkRegistration(uploadId, actor);
  }

  /**
   * Executes transactional batch registration for all valid staged rows
   */
  async executeBulkRegistration(
    uploadId: string,
    actor?: { userId: string; email?: string },
  ): Promise<{
    uploadId: string;
    totalValid: number;
    activated: number;
    failed: number;
    status: string;
  }> {
    const validRows = await this.prisma.bulkUploadRow.findMany({
      where: {
        uploadId,
        validationStatus: 'VALID',
        activationStatus: 'PENDING',
        deduplicationStatus: 'UNIQUE',
      },
      orderBy: { rowNumber: 'asc' },
    });

    let activated = 0;
    let failed = 0;

    const CHUNK_SIZE = 50;
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);

      for (const row of chunk) {
        const data = row.normalizedData as any;

        try {
          await this.prisma.$transaction(async (tx) => {
            // 1. Race condition duplicate check inside transaction
            const existingUser = await tx.user.findFirst({
              where: {
                OR: [
                  { mobileNumber: data.mobile },
                  { phone: data.mobile },
                  ...(data.email ? [{ email: data.email }] : []),
                ],
              },
            });

            if (existingUser) {
              throw new BadRequestException(
                `Mobile '${data.mobile}' or email '${data.email}' already registered.`,
              );
            }

            // 2. Create User (passwordless, status ACTIVE, verified)
            const newUser = await tx.user.create({
              data: {
                phone: data.mobile,
                mobileNumber: data.mobile,
                email: data.email || null,
                status: 'ACTIVE',
                isVerified: true,
                isActive: true,
                mobileVerifiedAt: new Date(),
                emailVerifiedAt: data.email ? new Date() : null,
              },
            });

            // 3. Ensure STUDENT role exists & assign
            let studentRole = await tx.role.findUnique({
              where: { name: 'STUDENT' },
            });
            if (!studentRole) {
              studentRole = await tx.role.create({ data: { name: 'STUDENT' } });
            }

            await tx.userRole.create({
              data: { userId: newUser.id, roleId: studentRole.id },
            });

            // 4. Generate unique sequential collision-safe Student ID
            const year = new Date().getFullYear();
            let sequenceNum = (await tx.student.count()) + 1;
            let studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
            let studentCode = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;

            let collision = await tx.student.findFirst({
              where: { OR: [{ studentCode }, { studentId: studentIdStr }] },
            });
            while (collision) {
              sequenceNum++;
              studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
              studentCode = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;
              collision = await tx.student.findFirst({
                where: { OR: [{ studentCode }, { studentId: studentIdStr }] },
              });
            }

            // 5. Create Student profile
            const student = await tx.student.create({
              data: {
                userId: newUser.id,
                studentId: studentIdStr,
                studentCode,
                name: data.name,
                state: data.state || 'Not Specified',
                district: data.city || 'Not Specified',
                stateId: data.stateId || null,
                districtId: data.districtId || null,
                schoolCollege: data.schoolCollege || 'Not Specified',
                classId: data.classId,
                examTargetId: data.examTargetId,
                preferredLanguageId: data.preferredLanguageId,
                status: 'ACTIVE',
              },
            });

            // 6. Update Row status
            await tx.bulkUploadRow.update({
              where: { id: row.id },
              data: {
                activationStatus: 'ACTIVATED',
                matchedStudentId: student.id,
              },
            });
          });

          activated++;
        } catch (err: any) {
          failed++;
          this.logger.error(
            `Failed to register student row ${row.rowNumber} for upload ${uploadId}: ${err.message}`,
          );

          await this.prisma.bulkUploadRow.update({
            where: { id: row.id },
            data: {
              activationStatus: 'FAILED',
              activationError: err.message,
            },
          });
        }
      }

      // Update progress
      await this.prisma.bulkUpload.update({
        where: { id: uploadId },
        data: {
          activatedCount: activated,
          failedCount: failed,
        },
      });
    }

    const finalStatus =
      failed > 0 && activated > 0
        ? 'PARTIALLY_ACTIVATED'
        : failed > 0
          ? 'FAILED'
          : 'ACTIVATED';

    const finalUpload = await this.prisma.bulkUpload.update({
      where: { id: uploadId },
      data: {
        status: finalStatus as any,
        activatedCount: activated,
        failedCount: failed,
        activatedAt: new Date(),
      },
    });

    if (actor?.userId) {
      await this.securityEventService.log('STUDENTS_BULK_IMPORTED' as any, {
        userId: actor.userId,
        metadata: {
          uploadId,
          totalValid: validRows.length,
          activated,
          failed,
          status: finalStatus,
        },
      });
    }

    return {
      uploadId,
      totalValid: validRows.length,
      activated,
      failed,
      status: finalUpload.status,
    };
  }

  /**
   * Generates downloadable error report for failed / invalid rows
   */
  async generateErrorReport(
    uploadId: string,
    format: 'csv' | 'xlsx' = 'xlsx',
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const upload = await this.prisma.bulkUpload.findUnique({
      where: { id: uploadId },
      include: {
        rows: {
          where: {
            OR: [
              { validationStatus: 'INVALID' },
              { activationStatus: 'FAILED' },
              { deduplicationStatus: { not: 'UNIQUE' } },
            ],
          },
          orderBy: { rowNumber: 'asc' },
          include: { errors: true },
        },
      },
    });

    if (!upload) {
      throw new NotFoundException(`Upload batch '${uploadId}' not found.`);
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Error Report');

    sheet.columns = [
      { header: 'Row #', key: 'rowNumber', width: 10 },
      { header: 'Full Name', key: 'name', width: 22 },
      { header: 'Mobile Number', key: 'mobile', width: 18 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Error Reasons', key: 'errors', width: 45 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF991B1B' }, // Dark red
      };
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    upload.rows.forEach((r) => {
      const data = (r.normalizedData || r.rawData) as any;
      const errorMsg =
        r.activationError ||
        r.errors.map((e) => `[${e.field}] ${e.message}`).join('; ') ||
        `Deduplication status: ${r.deduplicationStatus}`;

      sheet.addRow({
        rowNumber: r.rowNumber,
        name: data?.name || 'N/A',
        mobile: data?.mobile || data?.phone || 'N/A',
        email: data?.email || 'N/A',
        status: r.activationStatus === 'FAILED' ? 'ACTIVATION_FAILED' : r.validationStatus,
        errors: errorMsg,
      });
    });

    if (format === 'csv') {
      const buffer = (await workbook.csv.writeBuffer()) as unknown as Buffer;
      return {
        buffer: Buffer.from(buffer),
        fileName: `bulk_student_errors_${uploadId.substring(0, 8)}.csv`,
        mimeType: 'text/csv',
      };
    } else {
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
      return {
        buffer: Buffer.from(buffer),
        fileName: `bulk_student_errors_${uploadId.substring(0, 8)}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
  }
}
