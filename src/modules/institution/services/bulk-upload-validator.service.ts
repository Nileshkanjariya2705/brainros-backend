import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ValidationError {
  uploadId: string;
  rowId: string;
  rowNumber: number;
  field: string;
  errorCode: string;
  message: string;
}

@Injectable()
export class BulkUploadValidatorService {
  private readonly logger = new Logger(BulkUploadValidatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate and deduplicate all staged rows for an upload.
   */
  async validateUpload(uploadId: string, batchId?: string): Promise<void> {
    const rows = await this.prisma.bulkUploadRow.findMany({
      where: { uploadId },
      orderBy: { rowNumber: 'asc' },
    });

    // Clear previous errors for revalidation
    await this.prisma.bulkUploadError.deleteMany({ where: { uploadId } });

    const allErrors: ValidationError[] = [];
    const mobilesSeen = new Map<string, number>(); // mobile → first row number
    const emailsSeen = new Map<string, number>(); // email → first row number

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let existingStudentCount = 0;
    let newStudentCount = 0;

    for (const row of rows) {
      const data = row.normalizedData as any;
      const rowErrors: Omit<ValidationError, 'uploadId'>[] = [];

      // ─── Field validation ───
      if (!data.name || data.name.length < 2) {
        rowErrors.push({
          rowId: row.id, rowNumber: row.rowNumber,
          field: 'name', errorCode: 'MISSING_NAME',
          message: 'Student name is required (min 2 characters).',
        });
      }

      if (!data.mobile) {
        rowErrors.push({
          rowId: row.id, rowNumber: row.rowNumber,
          field: 'mobile', errorCode: 'MISSING_MOBILE',
          message: 'Mobile number is required.',
        });
      } else if (!MOBILE_REGEX.test(data.mobile)) {
        rowErrors.push({
          rowId: row.id, rowNumber: row.rowNumber,
          field: 'mobile', errorCode: 'INVALID_MOBILE',
          message: `Invalid mobile number '${data.mobile}'. Must be 10 digits starting with 6-9.`,
        });
      }

      if (data.email && !EMAIL_REGEX.test(data.email)) {
        rowErrors.push({
          rowId: row.id, rowNumber: row.rowNumber,
          field: 'email', errorCode: 'INVALID_EMAIL',
          message: `Invalid email address '${data.email}'.`,
        });
      }

      // ─── In-file duplicate detection ───
      let dedupStatus = 'UNIQUE';

      if (data.mobile && MOBILE_REGEX.test(data.mobile)) {
        if (mobilesSeen.has(data.mobile)) {
          dedupStatus = 'DUPLICATE_IN_FILE';
          duplicateCount++;
          rowErrors.push({
            rowId: row.id, rowNumber: row.rowNumber,
            field: 'mobile', errorCode: 'DUPLICATE_MOBILE_IN_FILE',
            message: `Mobile '${data.mobile}' already appears on row ${mobilesSeen.get(data.mobile)}.`,
          });
        } else {
          mobilesSeen.set(data.mobile, row.rowNumber);
        }
      }

      // ─── Global deduplication (existing student match) ───
      let matchedStudentId: string | null = null;

      if (dedupStatus !== 'DUPLICATE_IN_FILE' && data.mobile && MOBILE_REGEX.test(data.mobile)) {
        const existingUser = await this.prisma.user.findFirst({
          where: {
            OR: [
              { phone: data.mobile },
              { mobileNumber: data.mobile },
            ],
          },
          include: { student: true },
        });

        if (existingUser?.student) {
          matchedStudentId = existingUser.student.id;
          dedupStatus = 'EXISTING_STUDENT';
          existingStudentCount++;

          // Check if already in batch
          if (batchId) {
            const existingMembership = await this.prisma.batchStudent.findUnique({
              where: {
                batchId_studentId: { batchId, studentId: matchedStudentId },
              },
            });

            if (existingMembership && existingMembership.status === 'ACTIVE') {
              dedupStatus = 'ALREADY_IN_BATCH';
              rowErrors.push({
                rowId: row.id, rowNumber: row.rowNumber,
                field: 'mobile', errorCode: 'STUDENT_ALREADY_IN_BATCH',
                message: `Student with mobile '${data.mobile}' is already an active member of this batch.`,
              });
            }
          }
        } else {
          newStudentCount++;
        }
      }

      // ─── Update row status ───
      const isValid = rowErrors.length === 0;
      if (isValid) validCount++;
      else invalidCount++;

      await this.prisma.bulkUploadRow.update({
        where: { id: row.id },
        data: {
          validationStatus: isValid ? 'VALID' : 'INVALID',
          deduplicationStatus: dedupStatus,
          matchedStudentId,
          errorCount: rowErrors.length,
        },
      });

      allErrors.push(
        ...rowErrors.map((e) => ({ ...e, uploadId })),
      );
    }

    // ─── Persist errors in bulk ───
    if (allErrors.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < allErrors.length; i += CHUNK) {
        await this.prisma.bulkUploadError.createMany({
          data: allErrors.slice(i, i + CHUNK),
        });
      }
    }

    // ─── Update upload summary ───
    await this.prisma.bulkUpload.update({
      where: { id: uploadId },
      data: {
        validRowCount: validCount,
        invalidRowCount: invalidCount,
        duplicateRowCount: duplicateCount,
        existingStudentCount,
        newStudentCount,
        status: 'READY_FOR_REVIEW',
      },
    });

    this.logger.log(
      `Upload '${uploadId}' validated: ${validCount} valid, ${invalidCount} invalid, ${duplicateCount} duplicates`,
    );
  }
}
