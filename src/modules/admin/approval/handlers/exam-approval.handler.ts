import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationQueueService } from '../../../notification/queues/notification-queue.service';

@Injectable()
export class ExamApprovalHandler implements IApprovalHandler {
  readonly entityType = 'EXAM';

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly notificationQueue?: NotificationQueueService,
  ) {}

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
      include: {
        status: true,
        sections: { select: { subjectId: true } },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${request.resourceId}' not found.`);
    }

    const beforeState = { status: exam.status.name, title: exam.title };

    // ── Check if entity is a Mock Test vs Live Exam ──
    const isMock =
      request.resourceType === 'MOCK_TEST' ||
      exam.title.toUpperCase().includes('MOCK') ||
      exam.title.toUpperCase().includes('PRACTICE') ||
      (exam.sections && exam.sections.length === 1);

    if (isMock) {
      // ── MOCK TEST WORKFLOW: APPROVAL -> ACTIVE (Available directly) ──
      let activeStatus = await db.examStatus.findUnique({
        where: { name: 'ACTIVE' },
      });
      if (!activeStatus) {
        activeStatus = await db.examStatus.create({
          data: { name: 'ACTIVE' },
        });
      }

      const updated = await db.exam.update({
        where: { id: exam.id },
        data: {
          statusId: activeStatus.id,
          approvedById: reviewerId,
          approvedAt: new Date(),
          activatedAt: new Date(),
        },
        include: { status: true },
      });

      await db.examLifecycleHistory.create({
        data: {
          examId: exam.id,
          action: 'APPROVE',
          fromStatus: exam.status.name,
          toStatus: 'ACTIVE',
          performedById: reviewerId,
          comments: comment || 'Mock test approved by Super Admin and made available to students.',
        },
      });

      // Dispatch async notification to eligible students
      if (this.notificationQueue) {
        try {
          this.notificationQueue.dispatchExamNotificationJob({
            type: 'MOCK_AVAILABLE' as any,
            examId: exam.id,
          });
        } catch {
          // Non-blocking notification dispatch
        }
      }

      const afterState = {
        status: 'ACTIVE',
        approvedById: reviewerId,
        approvedAt: updated.approvedAt,
        isMock: true,
        isAvailableToStudents: true,
      };
      return { beforeState, afterState };
    } else {
      // ── LIVE EXAM WORKFLOW: APPROVAL -> APPROVED (Awaiting Scheduling by Super Admin, NOT visible to students yet) ──
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
          comments: comment || 'Live exam approved by Super Admin. Awaiting scheduling.',
        },
      });

      const afterState = {
        status: 'APPROVED',
        approvedById: reviewerId,
        approvedAt: updated.approvedAt,
        isMock: false,
        isAwaitingScheduling: true,
        isAvailableToStudents: false,
      };
      return { beforeState, afterState };
    }
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
