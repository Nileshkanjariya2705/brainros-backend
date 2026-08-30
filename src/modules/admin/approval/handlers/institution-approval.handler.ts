import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class InstitutionApprovalHandler implements IApprovalHandler {
  readonly entityType = 'INSTITUTION';

  constructor(private readonly prisma: PrismaService) {}

  async validateEntity(entityId: string, tx?: any): Promise<any> {
    const db = tx || this.prisma;
    const inst = await db.institution.findUnique({
      where: { id: entityId },
    });

    if (!inst) {
      throw new NotFoundException(`Institution '${entityId}' not found.`);
    }

    if (inst.status === 'ACTIVE' || inst.status === 'APPROVED') {
      throw new BadRequestException(
        `Institution '${entityId}' is already in status '${inst.status}'.`,
      );
    }

    return inst;
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
    const inst = await db.institution.findUnique({
      where: { id: request.resourceId },
    });

    if (!inst) {
      throw new NotFoundException(
        `Institution '${request.resourceId}' not found.`,
      );
    }

    const beforeState = {
      status: inst.status,
      name: inst.name,
      code: inst.code,
    };

    const updated = await db.institution.update({
      where: { id: inst.id },
      data: {
        status: 'ACTIVE', // Approved institutions are activated for production
      },
    });

    const afterState = {
      status: updated.status,
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
    const inst = await db.institution.findUnique({
      where: { id: request.resourceId },
    });

    if (!inst) {
      throw new NotFoundException(
        `Institution '${request.resourceId}' not found.`,
      );
    }

    const beforeState = {
      status: inst.status,
      name: inst.name,
      code: inst.code,
    };

    const updated = await db.institution.update({
      where: { id: inst.id },
      data: {
        status: 'REJECTED',
      },
    });

    const afterState = { status: updated.status, rejectionReason: reason };
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
    const inst = await db.institution.findUnique({
      where: { id: request.resourceId },
    });

    if (!inst)
      throw new NotFoundException(
        `Institution '${request.resourceId}' not found.`,
      );

    const beforeState = { status: inst.status };
    const updated = await db.institution.update({
      where: { id: inst.id },
      data: { status: 'DRAFT' },
    });

    return { beforeState, afterState: { status: updated.status } };
  }
}
