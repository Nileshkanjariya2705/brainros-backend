import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { QuestionStatus } from '@prisma/client';

@Injectable()
export class QuestionApprovalHandler implements IApprovalHandler {
  readonly entityType = 'QUESTION';

  constructor(private readonly prisma: PrismaService) {}

  async validateEntity(entityId: string, tx?: any): Promise<any> {
    const db = tx || this.prisma;
    const question = await db.question.findUnique({
      where: { id: entityId },
    });

    if (!question) {
      throw new NotFoundException(`Question '${entityId}' not found.`);
    }

    if (question.status === QuestionStatus.APPROVED) {
      throw new BadRequestException(
        `Question '${entityId}' is already approved.`,
      );
    }

    return question;
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
    const question = await db.question.findUnique({
      where: { id: request.resourceId },
    });

    if (!question) {
      throw new NotFoundException(
        `Question '${request.resourceId}' not found.`,
      );
    }

    const beforeState = { status: question.status, version: question.version };

    const updated = await db.question.update({
      where: { id: question.id },
      data: {
        status: QuestionStatus.APPROVED,
        approvedById: reviewerId,
        approvedAt: new Date(),
        rejectedById: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    });

    // Record review history
    await db.questionReviewHistory.create({
      data: {
        questionId: question.id,
        reviewerId,
        fromStatus: question.status,
        toStatus: QuestionStatus.APPROVED,
        comments: comment || 'Approved via central workflow',
      },
    });

    const afterState = {
      status: updated.status,
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
    const question = await db.question.findUnique({
      where: { id: request.resourceId },
    });

    if (!question) {
      throw new NotFoundException(
        `Question '${request.resourceId}' not found.`,
      );
    }

    const beforeState = { status: question.status, version: question.version };

    const updated = await db.question.update({
      where: { id: question.id },
      data: {
        status: QuestionStatus.REJECTED,
        rejectedById: reviewerId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    // Record review history
    await db.questionReviewHistory.create({
      data: {
        questionId: question.id,
        reviewerId,
        fromStatus: question.status,
        toStatus: QuestionStatus.REJECTED,
        comments: reason,
      },
    });

    const afterState = {
      status: updated.status,
      rejectedById: reviewerId,
      rejectionReason: reason,
    };
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
    const question = await db.question.findUnique({
      where: { id: request.resourceId },
    });

    if (!question)
      throw new NotFoundException(
        `Question '${request.resourceId}' not found.`,
      );

    const beforeState = { status: question.status };
    const updated = await db.question.update({
      where: { id: question.id },
      data: { status: QuestionStatus.DRAFT },
    });

    return { beforeState, afterState: { status: updated.status } };
  }
}
