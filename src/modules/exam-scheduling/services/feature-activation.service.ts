import { Injectable, Logger } from '@nestjs/common';
import { FeatureCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SetFeatureActivationDto } from '../dto/calendar.dto';
import { AuditLogService } from '../../admin/audit/services/audit-log.service';

@Injectable()
export class FeatureActivationService {
  private readonly logger = new Logger(FeatureActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditLogService,
  ) {}

  /**
   * Check if a feature gate is currently active.
   */
  async isFeatureActive(
    featureCode: FeatureCode,
    targetType = 'GLOBAL',
    targetId = 'GLOBAL',
  ): Promise<boolean> {
    // 1. Check targeted gate first
    if (targetType !== 'GLOBAL' || targetId !== 'GLOBAL') {
      const targeted = await this.prisma.featureActivation.findUnique({
        where: {
          featureCode_targetType_targetId: {
            featureCode,
            targetType,
            targetId,
          },
        },
      });
      if (targeted) return targeted.isActive;
    }

    // 2. Fall back to Global gate
    const globalGate = await this.prisma.featureActivation.findUnique({
      where: {
        featureCode_targetType_targetId: {
          featureCode,
          targetType: 'GLOBAL',
          targetId: 'GLOBAL',
        },
      },
    });

    return globalGate ? globalGate.isActive : true; // default active if no gate configured
  }

  /**
   * Set feature gate state with Super Admin audit logging.
   */
  async setFeatureActivation(
    dto: SetFeatureActivationDto,
    actorUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const targetType = dto.targetType || 'GLOBAL';
    const targetId = dto.targetId || 'GLOBAL';

    const existing = await this.prisma.featureActivation.findUnique({
      where: {
        featureCode_targetType_targetId: {
          featureCode: dto.featureCode,
          targetType,
          targetId,
        },
      },
    });

    const beforeState = existing ? { isActive: existing.isActive } : null;

    const record = await this.prisma.featureActivation.upsert({
      where: {
        featureCode_targetType_targetId: {
          featureCode: dto.featureCode,
          targetType,
          targetId,
        },
      },
      update: {
        isActive: dto.isActive,
        activatedById: dto.isActive ? actorUserId : existing?.activatedById,
        activatedAt: dto.isActive ? new Date() : existing?.activatedAt,
        deactivatedById: !dto.isActive ? actorUserId : existing?.deactivatedById,
        deactivatedAt: !dto.isActive ? new Date() : existing?.deactivatedAt,
        reason: dto.reason || null,
      },
      create: {
        featureCode: dto.featureCode,
        targetType,
        targetId,
        isActive: dto.isActive,
        activatedById: dto.isActive ? actorUserId : null,
        activatedAt: dto.isActive ? new Date() : null,
        deactivatedById: !dto.isActive ? actorUserId : null,
        deactivatedAt: !dto.isActive ? new Date() : null,
        reason: dto.reason || null,
      },
    });

    await this.auditService.logAction({
      actorUserId,
      action: dto.isActive ? 'ACTIVATE_FEATURE' : 'DEACTIVATE_FEATURE',
      entityType: 'FEATURE_ACTIVATION',
      entityId: `${dto.featureCode}:${targetType}:${targetId}`,
      beforeState,
      afterState: { isActive: record.isActive },
      reason: dto.reason,
      ipAddress,
      userAgent,
    });

    return record;
  }

  /**
   * Get all active & configured feature activations
   */
  async getAllActivations() {
    return this.prisma.featureActivation.findMany({
      orderBy: [{ featureCode: 'asc' }, { targetType: 'asc' }],
    });
  }
}
