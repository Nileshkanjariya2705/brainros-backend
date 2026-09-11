import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StudentApprovalHandler implements IApprovalHandler {
  readonly entityType = 'STUDENT';

  constructor(private readonly prisma: PrismaService) {}

  async validateEntity(entityId: string, tx?: any): Promise<any> {
    const db = tx || this.prisma;
    const student = await db.student.findUnique({
      where: { id: entityId },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException(`Student '${entityId}' not found.`);
    }

    if (student.status === 'ACTIVE') {
      throw new BadRequestException(
        `Student '${entityId}' is already ACTIVE and approved.`,
      );
    }

    return student;
  }

  async onApprove(
    request: any,
    reviewerId: string,
    comment?: string,
    tx?: any,
  ): Promise<{
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  }> {
    const db = tx || this.prisma;
    const student = await db.student.findUnique({
      where: { id: request.resourceId },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException(
        `Student '${request.resourceId}' not found.`,
      );
    }

    const beforeState = {
      studentStatus: student.status,
      userStatus: student.user?.status,
      studentId: student.studentId,
      studentCode: student.studentCode,
    };

    // 1. Activate Student record
    const updatedStudent = await db.student.update({
      where: { id: student.id },
      data: {
        status: 'ACTIVE',
      },
    });

    // 2. Activate User record so student can now log in
    if (student.userId) {
      await db.user.update({
        where: { id: student.userId },
        data: {
          status: 'ACTIVE',
          isActive: true,
          isVerified: true,
        },
      });
    }

    const afterState = {
      studentStatus: updatedStudent.status,
      userStatus: 'ACTIVE',
      approvedById: reviewerId,
      comment,
    };

    return { beforeState, afterState };
  }

  async onReject(
    request: any,
    reviewerId: string,
    reason: string,
    tx?: any,
  ): Promise<{
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  }> {
    const db = tx || this.prisma;
    const student = await db.student.findUnique({
      where: { id: request.resourceId },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException(
        `Student '${request.resourceId}' not found.`,
      );
    }

    const beforeState = {
      studentStatus: student.status,
      userStatus: student.user?.status,
    };

    // Mark student as INACTIVE
    const updatedStudent = await db.student.update({
      where: { id: student.id },
      data: {
        status: 'INACTIVE',
      },
    });

    // Disable User account
    if (student.userId) {
      await db.user.update({
        where: { id: student.userId },
        data: {
          status: 'DISABLED',
          isActive: false,
        },
      });
    }

    const afterState = {
      studentStatus: updatedStudent.status,
      userStatus: 'DISABLED',
      rejectedById: reviewerId,
      rejectionReason: reason,
    };

    return { beforeState, afterState };
  }
}
