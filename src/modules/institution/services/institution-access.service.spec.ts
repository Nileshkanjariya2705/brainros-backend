import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { InstitutionAccessService } from './institution-access.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InstitutionAccessService (Tenant Isolation & Anti-IDOR)', () => {
  let service: InstitutionAccessService;
  let prisma: any;

  const mockAdminUser = {
    id: 'admin-1',
    userId: 'user-admin-1',
    institutionId: 'inst-1',
    role: 'ADMIN',
    isActive: true,
    institution: {
      id: 'inst-1',
      name: 'ABC Coaching',
      code: 'ABC001',
      status: 'ACTIVE',
    },
  };

  beforeEach(async () => {
    prisma = {
      institutionAdmin: {
        findFirst: jest.fn(),
      },
      institutionBatch: {
        findUnique: jest.fn(),
      },
      batchStudent: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      bulkUpload: {
        findUnique: jest.fn(),
      },
      reportJob: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstitutionAccessService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InstitutionAccessService>(InstitutionAccessService);
  });

  describe('getMyInstitution', () => {
    it('should return institution and admin if active link exists', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);

      const result = await service.getMyInstitution('user-admin-1');
      expect(result.institution.id).toBe('inst-1');
      expect(result.admin.role).toBe('ADMIN');
    });

    it('should throw 403 Forbidden if user is not an active institution admin', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(null);

      await expect(service.getMyInstitution('random-user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertCanAccessInstitution (Cross-Tenant Protection)', () => {
    it('should allow access to matching institution', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);

      const result = await service.assertCanAccessInstitution(
        'user-admin-1',
        'inst-1',
      );
      expect(result.institution.id).toBe('inst-1');
    });

    it('should block and throw 403 when trying to access another institution ID', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);

      await expect(
        service.assertCanAccessInstitution('user-admin-1', 'inst-2-another'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertCanAccessBatch', () => {
    it('should allow access to batch belonging to user institution', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);
      prisma.institutionBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        institutionId: 'inst-1',
        name: 'NEET 2027',
      });

      const result = await service.assertCanAccessBatch(
        'user-admin-1',
        'batch-1',
      );
      expect(result.batch.name).toBe('NEET 2027');
    });

    it('should throw 403 if batch belongs to another institution', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);
      prisma.institutionBatch.findUnique.mockResolvedValue({
        id: 'batch-foreign',
        institutionId: 'inst-foreign-999',
        name: 'Foreign Batch',
      });

      await expect(
        service.assertCanAccessBatch('user-admin-1', 'batch-foreign'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertCanAccessStudent', () => {
    it('should allow access if student has batch membership in institution', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);
      prisma.batchStudent.findFirst.mockResolvedValue({
        id: 'bs-1',
        studentId: 'student-1',
        batch: { id: 'batch-1', institutionId: 'inst-1' },
        student: { id: 'student-1', name: 'John Doe' },
      });

      const result = await service.assertCanAccessStudent(
        'user-admin-1',
        'student-1',
      );
      expect(result.student.name).toBe('John Doe');
    });

    it('should throw 403 if student does not belong to institution', async () => {
      prisma.institutionAdmin.findFirst.mockResolvedValue(mockAdminUser);
      prisma.batchStudent.findFirst.mockResolvedValue(null);

      await expect(
        service.assertCanAccessStudent('user-admin-1', 'unauthorized-student'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
