import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ExamApprovalHandler implements IApprovalHandler {
  readonly entityType = 'EXAM';

  constructor(private readonly prisma: PrismaService) {}

  async validateEntity(entityId: string, tx?: any): Promise<any> {
    const db = tx || this.prisma;
    const exam = await db.exam.findUnique({
      where: { id: entityId },
      include: { status: true },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${entityId}' not found.`);
    }

    if (
      ['APPROVED', 'SCHEDULED', 'ACTIVE', 'COMPLETED'].includes(
        exam.status.name,
      )
    ) {
      throw new BadRequestException(
        `Exam '${entityId}' is already in status '${exam.status.name}'.`,
      );
    }

    return exam;
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
    const exam = await db.exam.findUnique({
      where: { id: request.resourceId },
      include: { status: true },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${request.resourceId}' not found.`);
    }

    const beforeState = { status: exam.status.name, title: exam.title };

    let approvedStatus = await db.examStatus.findUnique({
      where: { name: 'APPROVED' },
    });
    if (!approvedStatus) {
      approvedStatus = await db.examStatus.create({
        data: { name: 'APPROVED' },
      });
    }

    const updated = await db.exam.update({
      where: { id: exam.id },
      data: {
        statusId: approvedStatus.id,
        approvedById: reviewerId,
        approvedAt: new Date(),
      },
      include: { status: true },
    });

    await db.examLifecycleHistory.create({
      data: {
        examId: exam.id,
        action: 'APPROVE',
        fromStatus: exam.status.name,
        toStatus: 'APPROVED',
        performedById: reviewerId,
        comments: comment || 'Approved via central workflow',
      },
    });

    const afterState = {
      status: updated.status.name,
      approvedById: reviewerId,
      approvedAt: updated.approvedAt,
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
    const exam = await db.exam.findUnique({
      where: { id: request.resourceId },
      include: { status: true },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${request.resourceId}' not found.`);
    }

    const beforeState = { status: exam.status.name, title: exam.title };

    let cancelledStatus = await db.examStatus.findUnique({
      where: { name: 'CANCELLED' },
    });
    if (!cancelledStatus) {
      cancelledStatus = await db.examStatus.create({
        data: { name: 'CANCELLED' },
      });
    }

    const updated = await db.exam.update({
      where: { id: exam.id },
      data: { statusId: cancelledStatus.id },
      include: { status: true },
    });

    await db.examLifecycleHistory.create({
      data: {
        examId: exam.id,
        action: 'CANCEL',
        fromStatus: exam.status.name,
        toStatus: 'CANCELLED',
        performedById: reviewerId,
        comments: reason,
      },
    });

    const afterState = { status: updated.status.name, reason };
    return { beforeState, afterState };
  }

  async onCancel(
    request: any,
    actorId: string,
    tx?: any,
  ): Promise<{
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  }> {
    const db = tx || this.prisma;
    const exam = await db.exam.findUnique({
      where: { id: request.resourceId },
      include: { status: true },
    });
    if (!exam)
      throw new NotFoundException(`Exam '${request.resourceId}' not found.`);

    let draftStatus = await db.examStatus.findUnique({
      where: { name: 'DRAFT' },
    });
    if (!draftStatus) {
      draftStatus = await db.examStatus.create({ data: { name: 'DRAFT' } });
    }

    const updated = await db.exam.update({
      where: { id: exam.id },
      data: { statusId: draftStatus.id },
      include: { status: true },
    });

    return {
      beforeState: { status: exam.status.name },
      afterState: { status: updated.status.name },
    };
  }
}
