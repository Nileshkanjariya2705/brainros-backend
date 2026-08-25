import { Test, TestingModule } from '@nestjs/testing';
import { FeatureCode } from '@prisma/client';
import { FeatureActivationService } from './feature-activation.service';
import { AuditLogService } from '../../admin/audit/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FeatureActivationService (Platform Capability Gates & Auditing)', () => {
  let service: FeatureActivationService;
  let prisma: any;
  let auditService: any;

  beforeEach(async () => {
    prisma = {
      featureActivation: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockImplementation((args) => ({
          featureCode: args.where.featureCode_targetType_targetId.featureCode,
          targetType: args.where.featureCode_targetType_targetId.targetType,
          targetId: args.where.featureCode_targetType_targetId.targetId,
          ...args.create,
        })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    auditService = {
      logAction: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureActivationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditService },
      ],
    }).compile();

    service = module.get<FeatureActivationService>(FeatureActivationService);
  });

  describe('isFeatureActive', () => {
    it('should return true by default when no gate is recorded in database', async () => {
      prisma.featureActivation.findUnique.mockResolvedValue(null);

      const active = await service.isFeatureActive(FeatureCode.EXAM_ACCESS);
      expect(active).toBe(true);
    });

    it('should return the explicit configured state when found in database', async () => {
      prisma.featureActivation.findUnique.mockResolvedValue({
        featureCode: FeatureCode.RESULT_ACCESS,
        targetType: 'GLOBAL',
        targetId: 'GLOBAL',
        isActive: false,
      });

      const active = await service.isFeatureActive(FeatureCode.RESULT_ACCESS);
      expect(active).toBe(false);
    });
  });

  describe('setFeatureActivation', () => {
    it('should upsert gate state and create immutable audit log record', async () => {
      prisma.featureActivation.findUnique.mockResolvedValue(null);

      const res = await service.setFeatureActivation(
        {
          featureCode: FeatureCode.RANKING,
          isActive: true,
          reason: 'National ranks calculated and verified',
        },
        'super-admin-1',
      );

      expect(res.isActive).toBe(true);
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ACTIVATE_FEATURE',
          actorUserId: 'super-admin-1',
          entityType: 'FEATURE_ACTIVATION',
        }),
      );
    });
  });
});
