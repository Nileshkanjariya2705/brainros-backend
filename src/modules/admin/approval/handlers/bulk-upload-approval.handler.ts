import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { BulkUploadActivationService } from '../../../institution/services/bulk-upload-activation.service';

@Injectable()
export class BulkUploadApprovalHandler implements IApprovalHandler {
  readonly entityType = 'BULK_UPLOAD';

  constructor(
    private readonly prisma: PrismaService,
    private readonly activator: BulkUploadActivationService,
  ) {}

  async validateEntity(entityId: string, tx?: any): Promise<any> {
    const db = tx || this.prisma;
    const upload = await db.bulkUpload.findUnique({
      where: { id: entityId },
    });

    if (!upload) {
      throw new NotFoundException(`Bulk upload '${entityId}' not found.`);
    }

    if (upload.status === 'ACTIVATED' || upload.status === 'APPROVED') {
      throw new BadRequestException(`Bulk upload '${entityId}' is already in status '${upload.status}'.`);
    }

    return upload;
  }

  async onApprove(
    request: any,
    reviewerId: string,
    comment?: string,
    tx?: any,
  ): Promise<{ beforeState: Record<string, any>; afterState: Record<string, any> }> {
    const db = tx || this.prisma;
    const upload = await db.bulkUpload.findUnique({
      where: { id: request.resourceId },
    });

    if (!upload) {
      throw new NotFoundException(`Bulk upload '${request.resourceId}' not found.`);
    }

    const beforeState = { status: upload.status, validRowCount: upload.validRowCount };

    const updated = await db.bulkUpload.update({
      where: { id: upload.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: reviewerId,
      },
    });

    // Trigger transactional activation pipeline
    const activationResult = await this.activator.activateUpload(upload.id);

    const afterState = {
      status: 'ACTIVATED',
      approvedById: reviewerId,
      activation: activationResult,
    };
    return { beforeState, afterState };
  }

  async onReject(
    request: any,
    reviewerId: string,
    reason: string,
    tx?: any,
  ): Promise<{ beforeState: Record<string, any>; afterState: Record<string, any> }> {
    const db = tx || this.prisma;
    const upload = await db.bulkUpload.findUnique({
      where: { id: request.resourceId },
    });

    if (!upload) {
      throw new NotFoundException(`Bulk upload '${request.resourceId}' not found.`);
    }

    const beforeState = { status: upload.status };

    const updated = await db.bulkUpload.update({
      where: { id: upload.id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
      },
    });

    const afterState = { status: updated.status, rejectionReason: reason };
    return { beforeState, afterState };
  }

  async onCancel(
    request: any,
    actorId: string,
    tx?: any,
  ): Promise<{ beforeState: Record<string, any>; afterState: Record<string, any> }> {
    const db = tx || this.prisma;
    const upload = await db.bulkUpload.findUnique({
      where: { id: request.resourceId },
    });

    if (!upload) throw new NotFoundException(`Bulk upload '${request.resourceId}' not found.`);

    const beforeState = { status: upload.status };
    const updated = await db.bulkUpload.update({
      where: { id: upload.id },
      data: { status: 'READY_FOR_REVIEW' },
    });

    return { beforeState, afterState: { status: updated.status } };
  }
}
