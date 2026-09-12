import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BillPdfService } from './bill-pdf.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

describe('BillingService - Invalid Combinations & Guard Tests', () => {
  let service: BillingService;
  let prisma: any;

  const mockPrisma = {
    systemSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    institution: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    student: {
      count: jest.fn(),
    },
    bill: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockPdfService = {
    generateBillPdf: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  const mockJobProgressService = {
    publishStarted: jest.fn(),
    publishProgress: jest.fn(),
    publishCompleted: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BillPdfService, useValue: mockPdfService },
        { provide: 'BullQueue_bill-email', useValue: mockQueue },
        { provide: JobProgressService, useValue: mockJobProgressService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('1. Duplicate Invoice Generation Guard', () => {
    it('should throw ConflictException if invoice already exists for same school + month + year', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'school-123',
        name: 'Delhi Public School',
      });

      mockPrisma.bill.findUnique.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'INV-202608-0001',
      });

      await expect(
        service.generateInvoice(
          { institutionId: 'school-123', billingMonth: 8, billingYear: 2026 },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('2. Zero Active Students Protection Guard', () => {
    it('should throw BadRequestException if target school has 0 eligible active students', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'school-456',
        name: 'Empty Academy',
      });

      // Existing bill check returns null (not a duplicate)
      mockPrisma.bill.findUnique.mockResolvedValue(null);

      // Student count returns 0
      mockPrisma.student.count.mockResolvedValue(0);

      await expect(
        service.generateInvoice(
          { institutionId: 'school-456', billingMonth: 8, billingYear: 2026 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Non-Existent School Protection Guard', () => {
    it('should throw NotFoundException if school ID does not exist', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue(null);

      await expect(
        service.generateInvoice(
          { institutionId: 'non-existent-id', billingMonth: 8, billingYear: 2026 },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('4. Invalid Pricing Rate Guard', () => {
    it('should throw BadRequestException if new price is <= 0', async () => {
      await expect(service.updatePricingSetting(0, 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.updatePricingSetting(-50, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('5. Invalid GST Tax Configuration Guard', () => {
    it('should throw BadRequestException if GST rate is negative or exceeds 100%', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTaxConfiguration({ gstRate: -15 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateTaxConfiguration({ gstRate: 150 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('6. Invalid Email Dispatch Guard', () => {
    it('should throw BadRequestException if school email is missing or invalid', async () => {
      mockPrisma.bill.findUnique.mockResolvedValue({
        id: 'bill-1',
        institution: { name: 'School Without Email', email: null },
      });

      await expect(service.sendBill('bill-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if email dispatch job is already QUEUED or PROCESSING', async () => {
      mockPrisma.bill.findUnique.mockResolvedValue({
        id: 'bill-2',
        emailStatus: 'QUEUED',
        institution: { name: 'Processing School', email: 'billing@school.com' },
      });

      await expect(service.sendBill('bill-2', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });
});
