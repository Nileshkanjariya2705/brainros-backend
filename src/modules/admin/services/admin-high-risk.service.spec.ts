import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminHighRiskService } from './admin-high-risk.service';
import { ExamLifecycleService } from '../../exam-scheduling/services/exam-lifecycle.service';
import { AuditLogService } from '../audit/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AdminHighRiskService (Protected Operations & Auditing)', () => {
  let service: AdminHighRiskService;
  let prisma: any;
  let lifecycleService: any;
  let auditService: any;

  beforeEach(async () => {
    prisma = {
      exam: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      examStatus: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      examLifecycleHistory: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) =>
        typeof cb === 'function' ? cb(prisma) : Promise.all(cb),
      ),
    };

    lifecycleService = {
      activateExam: jest
        .fn()
        .mockResolvedValue({ id: 'exam-1', status: 'ACTIVE' }),
    };

    auditService = {
      logAction: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminHighRiskService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExamLifecycleService, useValue: lifecycleService },
        { provide: AuditLogService, useValue: auditService },
      ],
    }).compile();

    service = module.get<AdminHighRiskService>(AdminHighRiskService);
  });

  describe('activateExam', () => {
    it('should reject activation if exam is in DRAFT status', async () => {
      prisma.exam.findUnique.mockResolvedValue({
        id: 'exam-1',
        title: 'Draft Exam',
        status: { name: 'DRAFT' },
      });

      await expect(
        service.activateExam('exam-1', 'super-admin-1'),
      ).rejects.toThrow(BadRequestException);

      expect(lifecycleService.activateExam).not.toHaveBeenCalled();
    });

    it('should activate APPROVED exam via lifecycle service and record audit log', async () => {
      prisma.exam.findUnique.mockResolvedValue({
        id: 'exam-1',
        title: 'NEET Mock 1',
        status: { name: 'APPROVED' },
      });

      const res = await service.activateExam(
        'exam-1',
        'super-admin-1',
        'idemp-key-1',
      );
      expect(res.status).toBe('ACTIVE');
      expect(lifecycleService.activateExam).toHaveBeenCalledWith(
        'exam-1',
        'super-admin-1',
        expect.anything(),
      );
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ACTIVATE_EXAM',
          actorUserId: 'super-admin-1',
          entityType: 'EXAM',
          entityId: 'exam-1',
        }),
      );
    });

    it('should return idempotent success if exam is already active', async () => {
      prisma.exam.findUnique.mockResolvedValue({
        id: 'exam-1',
        title: 'NEET Mock 1',
        status: { name: 'ACTIVE' },
      });

      const res = await service.activateExam('exam-1', 'super-admin-1');
      expect(res.status).toBe('ACTIVE');
      expect(lifecycleService.activateExam).not.toHaveBeenCalled();
    });
  });

  describe('deactivateExam', () => {
    it('should require a non-empty deactivation reason', async () => {
      await expect(
        service.deactivateExam('exam-1', 'super-admin-1', ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('should deactivate active exam and create audit log', async () => {
      prisma.exam.findUnique.mockResolvedValue({
        id: 'exam-1',
        title: 'Active Exam',
        status: { name: 'ACTIVE' },
      });
      prisma.examStatus.findUnique.mockResolvedValue({
        id: 'status-ended',
        name: 'ENDED',
      });
      prisma.exam.update.mockResolvedValue({ id: 'exam-1', status: 'ENDED' });

      const res = await service.deactivateExam(
        'exam-1',
        'super-admin-1',
        'Severe blueprint error found',
      );

      expect(res.status).toBe('ENDED');
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEACTIVATE_EXAM',
          actorUserId: 'super-admin-1',
          reason: 'Severe blueprint error found',
        }),
      );
    });
  });

  describe('bulkActivateExams', () => {
    it('should process each exam independently and return aggregate results', async () => {
      prisma.exam.findUnique
        .mockResolvedValueOnce({
          id: 'exam-1',
          status: { name: 'APPROVED' },
          title: 'E1',
        })
        .mockResolvedValueOnce({
          id: 'exam-2',
          status: { name: 'DRAFT' },
          title: 'E2',
        });

      const res = await service.bulkActivateExams(
        ['exam-1', 'exam-2'],
        'super-admin-1',
      );

      expect(res.total).toBe(2);
      expect(res.activatedCount).toBe(1);
      expect(res.failedCount).toBe(1);
      expect(res.results[0].status).toBe('ACTIVATED');
      expect(res.results[1].status).toBe('FAILED');
    });
  });
});
