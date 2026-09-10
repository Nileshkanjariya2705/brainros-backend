import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StaffUpdateApprovalHandler implements IApprovalHandler {
  readonly entityType = 'STAFF_UPDATE';
  private readonly logger = new Logger(StaffUpdateApprovalHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async validateEntity(entityId: string, tx?: any): Promise<any> {
    // The entityId can be a student, institution, question, or other managed entity
    return { id: entityId, valid: true };
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
    const metadata = request.metadata || {};
    const targetType = (metadata.entityType || '').toUpperCase();
    const targetId = request.resourceId || metadata.entityId;
    const proposed = metadata.proposedValue || {};
    const current = metadata.currentValue || {};

    const beforeState = { ...current, status: 'PENDING_APPROVAL' };
    const afterState: Record<string, any> = { ...proposed, status: 'APPROVED', approvedBy: reviewerId, comment };

    this.logger.log(
      `Applying approved staff update for ${targetType} '${targetId}' by reviewer '${reviewerId}'`,
    );

    try {
      if (targetType === 'STUDENT') {
        const updateData: any = {};
        if (proposed.name !== undefined) updateData.name = proposed.name;
        if (proposed.schoolCollege !== undefined) updateData.schoolCollege = proposed.schoolCollege;
        if (proposed.status !== undefined) updateData.status = proposed.status;
        if (proposed.classId !== undefined) updateData.classId = proposed.classId;
        if (proposed.examTargetId !== undefined) updateData.examTargetId = proposed.examTargetId;

        await db.student.update({
          where: { id: targetId },
          data: updateData,
        });
      } else if (targetType === 'INSTITUTION' || targetType === 'SCHOOL') {
        const updateData: any = {};
        if (proposed.name !== undefined) updateData.name = proposed.name;
        if (proposed.email !== undefined) updateData.email = proposed.email;
        if (proposed.phone !== undefined) updateData.phone = proposed.phone;
        if (proposed.address !== undefined) updateData.address = proposed.address;
        if (proposed.city !== undefined) updateData.city = proposed.city;
        if (proposed.status !== undefined) updateData.status = proposed.status;

        await db.institution.update({
          where: { id: targetId },
          data: updateData,
        });
      } else if (targetType === 'USER' || targetType === 'STAFF') {
        const updateData: any = {};
        if (proposed.name !== undefined) updateData.name = proposed.name;
        if (proposed.email !== undefined) updateData.email = proposed.email;
        if (proposed.status !== undefined) updateData.status = proposed.status;

        await db.user.update({
          where: { id: targetId },
          data: updateData,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not apply automated DB mutation for ${targetType} '${targetId}': ${err.message}`);
    }

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
    const metadata = request.metadata || {};
    const beforeState = { ...metadata.currentValue, proposed: metadata.proposedValue };
    const afterState = { status: 'REJECTED', rejectionReason: reason, reviewedBy: reviewerId };

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
    return {
      beforeState: { status: 'PENDING' },
      afterState: { status: 'CANCELLED', cancelledBy: actorId },
    };
  }
}
