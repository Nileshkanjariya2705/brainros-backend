import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { ApprovalHandlerRegistry } from '../handlers/approval-handler.registry';
import {
  SubmitApprovalDto,
  ApproveRequestDto,
  RejectRequestDto,
  CancelRequestDto,
  ApprovalFilterDto,
} from '../../dto/admin.dto';

@Injectable()
export class ApprovalWorkflowService {
  private readonly logger = new Logger(ApprovalWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ApprovalHandlerRegistry,
    private readonly auditService: AuditLogService,
  ) {}

  /**
   * Submit an entity for administrative approval review.
   */
  async submit(dto: SubmitApprovalDto, submittedById: string, ipAddress?: string, userAgent?: string) {
    const handler = this.registry.getHandler(dto.entityType);

    // 1. Verify entity existence and eligibility via domain handler
    await handler.validateEntity(dto.entityId);

    // 2. Prevent duplicate pending requests for the same entity
    const existingPending = await this.prisma.approvalRequest.findFirst({
      where: {
        resourceType: dto.entityType.toUpperCase(),
        resourceId: dto.entityId,
        status: 'PENDING',
      },
    });

    if (existingPending) {
      throw new BadRequestException(
        `There is already an active PENDING approval request for ${dto.entityType} '${dto.entityId}'.`,
      );
    }

    // 3. Create ApprovalRequest record & AuditLog inside a transaction
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.create({
        data: {
          resourceType: dto.entityType.toUpperCase(),
          resourceId: dto.entityId,
          requestedById: submittedById,
          status: 'PENDING',
          metadata: dto.metadata || {},
          submittedAt: new Date(),
        },
      });

      await this.auditService.logAction({
        actorUserId: submittedById,
        action: 'SUBMIT_APPROVAL',
        entityType: dto.entityType.toUpperCase(),
        entityId: dto.entityId,
        afterState: { approvalRequestId: request.id, status: 'PENDING' },
        metadata: dto.metadata,
        ipAddress,
        userAgent,
        tx,
      });

      return request;
    });
  }

  /**
   * Approve a pending approval request.
   * Enforces self-approval prevention and executes domain-specific state transitions.
   */
  async approve(
    requestId: string,
    reviewerId: string,
    dto: ApproveRequestDto = {},
    ipAddress?: string,
    userAgent?: string,
  ) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${requestId}' not found.`);
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot approve request with status '${request.status}'. Only PENDING requests can be approved.`,
      );
    }

    // ── Self-Approval Prevention Rule ──
    if (request.requestedById === reviewerId) {
      this.logger.warn(`Self-approval blocked for user '${reviewerId}' on request '${requestId}'`);
      throw new ForbiddenException(
        'Self-approval is forbidden. An administrative action must be reviewed by another authorized administrator.',
      );
    }

    const handler = this.registry.getHandler(request.resourceType);

    return this.prisma.$transaction(async (tx) => {
      // Execute domain-specific transition
      const { beforeState, afterState } = await handler.onApprove(request, reviewerId, dto.comment, tx);

      const updatedRequest = await tx.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewComment: dto.comment || null,
        },
      });

      await this.auditService.logAction({
        actorUserId: reviewerId,
        action: 'APPROVE',
        entityType: request.resourceType,
        entityId: request.resourceId,
        beforeState,
        afterState,
        reason: dto.comment,
        ipAddress,
        userAgent,
        tx,
      });

      return updatedRequest;
    });
  }

  /**
   * Reject a pending approval request (mandatory reason).
   */
  async reject(
    requestId: string,
    reviewerId: string,
    dto: RejectRequestDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Rejection reason is required.');
    }

    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${requestId}' not found.`);
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot reject request with status '${request.status}'. Only PENDING requests can be rejected.`,
      );
    }

    const handler = this.registry.getHandler(request.resourceType);

    return this.prisma.$transaction(async (tx) => {
      const { beforeState, afterState } = await handler.onReject(request, reviewerId, dto.reason, tx);

      const updatedRequest = await tx.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: dto.reason,
          reviewComment: dto.comment || null,
        },
      });

      await this.auditService.logAction({
        actorUserId: reviewerId,
        action: 'REJECT',
        entityType: request.resourceType,
        entityId: request.resourceId,
        beforeState,
        afterState,
        reason: dto.reason,
        ipAddress,
        userAgent,
        tx,
      });

      return updatedRequest;
    });
  }

  /**
   * Cancel an open approval request.
   */
  async cancel(
    requestId: string,
    actorId: string,
    dto: CancelRequestDto = {},
    ipAddress?: string,
    userAgent?: string,
  ) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${requestId}' not found.`);
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot cancel request with status '${request.status}'.`);
    }

    const handler = this.registry.getHandler(request.resourceType);

    return this.prisma.$transaction(async (tx) => {
      let states = { beforeState: {}, afterState: {} };
      if (handler.onCancel) {
        states = await handler.onCancel(request, actorId, tx);
      }

      const updatedRequest = await tx.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: 'CANCELLED',
          rejectionReason: dto.reason || 'Cancelled by requester',
        },
      });

      await this.auditService.logAction({
        actorUserId: actorId,
        action: 'CANCEL_APPROVAL',
        entityType: request.resourceType,
        entityId: request.resourceId,
        beforeState: states.beforeState,
        afterState: states.afterState,
        reason: dto.reason,
        ipAddress,
        userAgent,
        tx,
      });

      return updatedRequest;
    });
  }

  /**
   * Bulk approve multiple requests with per-item validation and auditing.
   */
  async bulkApprove(
    requestIds: string[],
    reviewerId: string,
    comment?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const results: Array<{ id: string; status: 'APPROVED' | 'FAILED'; error?: string }> = [];

    for (const id of requestIds) {
      try {
        await this.approve(id, reviewerId, { comment }, ipAddress, userAgent);
        results.push({ id, status: 'APPROVED' });
      } catch (err: any) {
        results.push({ id, status: 'FAILED', error: err.message });
      }
    }

    return {
      total: requestIds.length,
      approvedCount: results.filter((r) => r.status === 'APPROVED').length,
      failedCount: results.filter((r) => r.status === 'FAILED').length,
      results,
    };
  }

  /**
   * Query approval requests with pagination and filters.
   */
  async getApprovalRequests(filter: ApprovalFilterDto) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.entityType) where.resourceType = filter.entityType.toUpperCase();
    if (filter.status) where.status = filter.status.toUpperCase();
    if (filter.submittedBy) where.requestedById = filter.submittedBy;

    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = new Date(filter.from);
      if (filter.to) where.createdAt.lte = new Date(filter.to);
    }

    const [items, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single approval request by ID with target entity preview.
   */
  async getApprovalById(id: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException(`Approval request '${id}' not found.`);
    }

    // Resolve target entity summary
    let entityPreview: any = null;
    try {
      if (request.resourceType === 'QUESTION') {
        entityPreview = await this.prisma.question.findUnique({
          where: { id: request.resourceId },
          include: {
            subject: { select: { name: true } },
            options: true,
          },
        });
      } else if (request.resourceType === 'EXAM') {
        entityPreview = await this.prisma.exam.findUnique({
          where: { id: request.resourceId },
          include: { examTarget: true, status: true },
        });
      } else if (request.resourceType === 'INSTITUTION') {
        entityPreview = await this.prisma.institution.findUnique({
          where: { id: request.resourceId },
        });
      } else if (request.resourceType === 'BULK_UPLOAD') {
        entityPreview = await this.prisma.bulkUpload.findUnique({
          where: { id: request.resourceId },
          include: { batch: true },
        });
      }
    } catch {
      // Graceful fallback
    }

    return {
      ...request,
      entityPreview,
    };
  }
}
