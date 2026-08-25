import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

const ACTIVATION_CHUNK_SIZE = 100;

@Injectable()
export class BulkUploadActivationService {
  private readonly logger = new Logger(BulkUploadActivationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Activate approved upload: create/match students and assign batch memberships.
   * Processes in chunks for database safety.
   */
  async activateUpload(uploadId: string): Promise<{ activated: number; failed: number }> {
    const upload = await this.prisma.bulkUpload.findUnique({
      where: { id: uploadId },
    });

    if (!upload || upload.status !== 'APPROVED') {
      throw new Error(`Upload '${uploadId}' is not in APPROVED status.`);
    }

    await this.prisma.bulkUpload.update({
      where: { id: uploadId },
      data: { status: 'ACTIVATING' },
    });

    // Only process VALID rows that haven't been activated yet
    const validRows = await this.prisma.bulkUploadRow.findMany({
      where: {
        uploadId,
        validationStatus: 'VALID',
        activationStatus: 'PENDING',
        deduplicationStatus: { notIn: ['DUPLICATE_IN_FILE', 'ALREADY_IN_BATCH'] },
      },
      orderBy: { rowNumber: 'asc' },
    });

    let activated = 0;
    let failed = 0;

    // Process in chunks
    for (let i = 0; i < validRows.length; i += ACTIVATION_CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + ACTIVATION_CHUNK_SIZE);

      for (const row of chunk) {
        try {
          await this.activateRow(row, upload.batchId, upload.institutionId);
          activated++;

          await this.prisma.bulkUploadRow.update({
            where: { id: row.id },
            data: { activationStatus: 'ACTIVATED' },
          });
        } catch (err) {
          failed++;
          this.logger.error(
            `Failed to activate row ${row.rowNumber} of upload '${uploadId}': ${err.message}`,
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

    // Final status
    const finalStatus = failed > 0 && activated > 0
      ? 'PARTIALLY_ACTIVATED'
      : failed > 0
        ? 'FAILED'
        : 'ACTIVATED';

    await this.prisma.bulkUpload.update({
      where: { id: uploadId },
      data: {
        status: finalStatus as any,
        activatedCount: activated,
        failedCount: failed,
        activatedAt: new Date(),
      },
    });

    this.logger.log(
      `Upload '${uploadId}' activation complete: ${activated} activated, ${failed} failed → ${finalStatus}`,
    );

    return { activated, failed };
  }

  /**
   * Activate a single row — create or match student, then assign batch membership.
   */
  private async activateRow(
    row: any,
    batchId: string | null,
    institutionId: string,
  ): Promise<void> {
    const data = row.normalizedData as any;

    if (row.matchedStudentId) {
      // ── Existing student: just assign batch membership ──
      if (batchId) {
        await this.prisma.batchStudent.upsert({
          where: {
            batchId_studentId: { batchId, studentId: row.matchedStudentId },
          },
          update: { status: 'ACTIVE', joinedAt: new Date(), leftAt: null },
          create: { batchId, studentId: row.matchedStudentId, status: 'ACTIVE' },
        });
      }
      return;
    }

    // ── New student: create User + Student ──
    await this.prisma.$transaction(async (tx) => {
      // Create user
      const tempPassword = await bcrypt.hash(`brainros_${data.mobile}`, 10);

      const user = await tx.user.create({
        data: {
          phone: data.mobile,
          mobileNumber: data.mobile,
          email: data.email || null,
          passwordHash: tempPassword,
          isActive: true,
          isVerified: false,
        },
      });

      // Resolve references
      const classRecord = data.class
        ? await tx.studentClass.findFirst({
            where: { name: { equals: data.class, mode: 'insensitive' } },
          })
        : await tx.studentClass.findFirst();

      const examTarget = data.examTarget
        ? await tx.examTarget.findFirst({
            where: { name: { contains: data.examTarget, mode: 'insensitive' } },
          })
        : await tx.examTarget.findFirst();

      const language = data.preferredLanguage
        ? await tx.preferredLanguage.findFirst({
            where: {
              OR: [
                { name: { equals: data.preferredLanguage, mode: 'insensitive' } },
                { code: { equals: data.preferredLanguage, mode: 'insensitive' } },
              ],
            },
          })
        : await tx.preferredLanguage.findFirst({ where: { isActive: true } });

      if (!classRecord || !examTarget || !language) {
        throw new Error(
          `Missing reference data: class=${!!classRecord}, examTarget=${!!examTarget}, language=${!!language}`,
        );
      }

      // Generate unique studentId
      const studentId = `BRN-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const student = await tx.student.create({
        data: {
          userId: user.id,
          studentId,
          name: data.name,
          state: data.state || 'Not Specified',
          district: data.district || 'Not Specified',
          schoolCollege: data.schoolCollege || 'Not Specified',
          classId: classRecord.id,
          examTargetId: examTarget.id,
          preferredLanguageId: language.id,
        },
      });

      // Assign batch membership
      if (batchId) {
        await tx.batchStudent.create({
          data: {
            batchId,
            studentId: student.id,
            status: 'ACTIVE',
          },
        });
      }

      // Update row with matched student
      await tx.bulkUploadRow.update({
        where: { id: row.id },
        data: { matchedStudentId: student.id },
      });
    });
  }
}
