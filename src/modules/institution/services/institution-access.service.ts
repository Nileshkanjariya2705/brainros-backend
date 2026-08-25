import {
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * InstitutionAccessService — Tenant isolation guard.
 *
 * Every institution-scoped endpoint must call one of the assert* methods
 * to ensure the authenticated user belongs to the target institution.
 * Similar in pattern to ParentStudentAccessService.
 */
@Injectable()
export class InstitutionAccessService {
  private readonly logger = new Logger(InstitutionAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the institution for the authenticated user.
   * Returns the Institution + admin record or throws 403.
   */
  async getMyInstitution(userId: string) {
    const admin = await this.prisma.institutionAdmin.findFirst({
      where: { userId, isActive: true },
      include: {
        institution: true,
      },
    });

    if (!admin) {
      this.logger.warn(`User '${userId}' is not an active institution admin`);
      throw new ForbiddenException(
        'Access denied. You are not an active institution administrator.',
      );
    }

    return { admin, institution: admin.institution };
  }

  /**
   * Assert the user has access to the specified institution.
   * Derives institution from user context — never trusts client-provided institutionId.
   */
  async assertCanAccessInstitution(userId: string, institutionId?: string) {
    const { admin, institution } = await this.getMyInstitution(userId);

    if (institutionId && institution.id !== institutionId) {
      this.logger.warn(
        `Unauthorized cross-institution access: User '${userId}' tried to access institution '${institutionId}' but belongs to '${institution.id}'`,
      );
      throw new ForbiddenException(
        'Access denied. You cannot access this institution.',
      );
    }

    return { admin, institution };
  }

  /**
   * Assert the user can access a specific batch.
   * Validates that the batch belongs to the user's institution.
   */
  async assertCanAccessBatch(userId: string, batchId: string) {
    const { admin, institution } = await this.getMyInstitution(userId);

    const batch = await this.prisma.institutionBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.institutionId !== institution.id) {
      this.logger.warn(
        `Unauthorized batch access: User '${userId}' tried to access batch '${batchId}'`,
      );
      throw new ForbiddenException(
        'Access denied. This batch does not belong to your institution.',
      );
    }

    return { admin, institution, batch };
  }

  /**
   * Assert the user can access a specific student through their institution's batches.
   * Validates the student has a membership in at least one of the institution's batches.
   */
  async assertCanAccessStudent(userId: string, studentId: string) {
    const { admin, institution } = await this.getMyInstitution(userId);

    const membership = await this.prisma.batchStudent.findFirst({
      where: {
        studentId,
        batch: {
          institutionId: institution.id,
        },
      },
      include: {
        student: {
          include: { examTarget: true, studentClass: true },
        },
        batch: true,
      },
    });

    if (!membership) {
      this.logger.warn(
        `Unauthorized student access: User '${userId}' tried to access student '${studentId}' not in institution '${institution.id}'`,
      );
      throw new ForbiddenException(
        'Access denied. This student is not part of your institution.',
      );
    }

    return { admin, institution, student: membership.student, membership };
  }

  /**
   * Assert the user can access a specific bulk upload.
   */
  async assertCanAccessUpload(userId: string, uploadId: string) {
    const { admin, institution } = await this.getMyInstitution(userId);

    const upload = await this.prisma.bulkUpload.findUnique({
      where: { id: uploadId },
    });

    if (!upload || upload.institutionId !== institution.id) {
      this.logger.warn(
        `Unauthorized upload access: User '${userId}' tried to access upload '${uploadId}'`,
      );
      throw new ForbiddenException(
        'Access denied. This upload does not belong to your institution.',
      );
    }

    return { admin, institution, upload };
  }

  /**
   * Assert the user can access a specific report job.
   */
  async assertCanAccessReport(userId: string, reportJobId: string) {
    const { admin, institution } = await this.getMyInstitution(userId);

    const report = await this.prisma.reportJob.findUnique({
      where: { id: reportJobId },
    });

    if (!report || report.institutionId !== institution.id) {
      this.logger.warn(
        `Unauthorized report access: User '${userId}' tried to access report '${reportJobId}'`,
      );
      throw new ForbiddenException(
        'Access denied. This report does not belong to your institution.',
      );
    }

    return { admin, institution, report };
  }

  /**
   * Get all student IDs belonging to the institution (across all batches).
   */
  async getInstitutionStudentIds(institutionId: string): Promise<string[]> {
    const memberships = await this.prisma.batchStudent.findMany({
      where: {
        batch: { institutionId },
        status: 'ACTIVE',
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });

    return memberships.map((m) => m.studentId);
  }

  /**
   * Get student IDs for a specific batch.
   */
  async getBatchStudentIds(batchId: string): Promise<string[]> {
    const memberships = await this.prisma.batchStudent.findMany({
      where: { batchId, status: 'ACTIVE' },
      select: { studentId: true },
    });

    return memberships.map((m) => m.studentId);
  }
}
