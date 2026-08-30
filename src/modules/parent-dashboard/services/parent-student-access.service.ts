import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ParentStudentAccessService {
  private readonly logger = new Logger(ParentStudentAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify parent has an ACTIVE link to the requested student.
   * Throws 403 Forbidden on any unauthorized access attempt (anti-IDOR).
   */
  async assertCanAccessStudent(parentId: string, studentId: string) {
    // 1. Resolve student entity by UUID id or studentId string
    const student = await this.prisma.student.findFirst({
      where: {
        OR: [{ id: studentId }, { studentId: studentId }],
      },
      include: {
        examTarget: true,
        studentClass: true,
      },
    });

    if (!student) {
      this.logger.warn(
        `Parent '${parentId}' attempted to access non-existent student '${studentId}'`,
      );
      throw new ForbiddenException(
        'Access denied. Student record not found or unauthorized.',
      );
    }

    // 2. Validate ACTIVE ParentStudentLink
    const link = await this.prisma.parentStudentLink.findUnique({
      where: {
        parentId_studentId: {
          parentId,
          studentId: student.id,
        },
      },
    });

    if (!link || link.status !== 'ACTIVE') {
      this.logger.warn(
        `Unauthorized access attempt: Parent '${parentId}' -> Student '${student.id}' (Link status: ${link?.status ?? 'NO_LINK'})`,
      );
      throw new ForbiddenException(
        'Access denied. You do not have an active parental link with this student.',
      );
    }

    return student;
  }

  /**
   * Check if parent can access student without throwing
   */
  async canAccessStudent(
    parentId: string,
    studentId: string,
  ): Promise<boolean> {
    try {
      await this.assertCanAccessStudent(parentId, studentId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all students actively linked to a parent
   */
  async getAuthorizedStudents(parentId: string) {
    const links = await this.prisma.parentStudentLink.findMany({
      where: {
        parentId,
        status: 'ACTIVE',
      },
      include: {
        student: {
          include: {
            examTarget: true,
            studentClass: true,
          },
        },
      },
      orderBy: { linkedAt: 'desc' },
    });

    return links.map((l) => l.student);
  }
}
