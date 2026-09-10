import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { BillPdfService } from './bill-pdf.service';
import {
  CreateBillDto,
  UpdateBillDto,
  RejectBillDto,
  BillFilterDto,
  GenerateInvoiceDto,
} from '../dto/billing.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BillEmailProcessor } from '../processors/bill-email.processor';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DEFAULT_PRICE_PER_STUDENT = 300;
const PRICING_SETTING_KEY = 'PRICE_PER_STUDENT_PER_MONTH';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfService: BillPdfService,
    @InjectQueue('bill-email')
    private readonly billEmailQueue: Queue,
    private readonly jobProgressService: JobProgressService,
    @Optional()
    private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * ── CENTRALIZED PRICING CONFIGURATION ──────────────────────────
   * Default: ₹300 per student per month.
   * Can be configured by Super Admin; stored in system_settings table.
   */
  async getPricingSetting(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: PRICING_SETTING_KEY },
    });
    if (!setting) {
      return DEFAULT_PRICE_PER_STUDENT;
    }
    const parsed = Number(setting.value);
    return isNaN(parsed) || parsed <= 0 ? DEFAULT_PRICE_PER_STUDENT : parsed;
  }

  async updatePricingSetting(
    newPrice: number,
    userId: string,
  ): Promise<{ pricePerStudent: number; message: string }> {
    if (!newPrice || isNaN(newPrice) || newPrice <= 0) {
      throw new BadRequestException('Invalid pricing rate. Price must be greater than zero.');
    }

    const oldPrice = await this.getPricingSetting();

    await this.prisma.systemSetting.upsert({
      where: { key: PRICING_SETTING_KEY },
      create: {
        key: PRICING_SETTING_KEY,
        value: String(newPrice),
        description: 'Centralized default price per student per month for institutional billing',
        updatedById: userId,
      },
      update: {
        value: String(newPrice),
        updatedById: userId,
      },
    });

    // Price Audit Log
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'PRICE_PER_STUDENT_CHANGED',
        entityType: 'SYSTEM_SETTING',
        entityId: PRICING_SETTING_KEY,
        beforeState: { pricePerStudent: oldPrice },
        afterState: { pricePerStudent: newPrice },
        metadata: {
          oldPrice,
          newPrice,
          changedAt: new Date().toISOString(),
        },
      },
    });

    this.logger.log(
      `Billing price per student updated from ₹${oldPrice} to ₹${newPrice} by user '${userId}'`,
    );

    return {
      pricePerStudent: newPrice,
      message: `Price per student per month updated to ₹${newPrice}. Future invoices will use this rate; historical invoices remain strictly unaffected.`,
    };
  }

  /**
   * ── DYNAMIC STUDENT COUNT ELIGIBILITY ──────────────────────────
   * Counts verified active students linked to this institution.
   * Inactive, suspended, deleted, or unverified students are excluded.
   */
  async countEligibleStudents(institutionId: string): Promise<number> {
    return this.prisma.student.count({
      where: {
        institutionId,
        status: 'ACTIVE',
        user: { isActive: true },
      },
    });
  }

  /**
   * Generates a unique, sequential server-side invoice number: INV-YYYYMM-XXXX
   */
  private async generateInvoiceNumber(billingYear?: number, billingMonth?: number): Promise<string> {
    const now = new Date();
    const year = billingYear || now.getFullYear();
    const month = billingMonth || now.getMonth() + 1;
    const yearMonth = `${year}${String(month).padStart(2, '0')}`;
    const prefix = `INV-${yearMonth}-`;

    const latest = await this.prisma.bill.findFirst({
      where: { billNumber: { startsWith: prefix } },
      orderBy: { billNumber: 'desc' },
      select: { billNumber: true },
    });

    let sequence = 1;
    if (latest && latest.billNumber) {
      const parts = latest.billNumber.split('-');
      const lastSeq = parseInt(parts[2] || '0', 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    return `${prefix}${String(sequence).padStart(4, '0')}`;
  }

  /**
   * Generates a unique sequential manual bill number: BILL-YYYYMM-XXXX
   */
  private async generateBillNumber(): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `BILL-${yearMonth}-`;

    const latest = await this.prisma.bill.findFirst({
      where: { billNumber: { startsWith: prefix } },
      orderBy: { billNumber: 'desc' },
      select: { billNumber: true },
    });

    let sequence = 1;
    if (latest && latest.billNumber) {
      const parts = latest.billNumber.split('-');
      const lastSeq = parseInt(parts[2] || '0', 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    return `${prefix}${String(sequence).padStart(4, '0')}`;
  }

  /**
   * Validates if a user is authorized to manage billing for an institution.
   */
  private async assertInstitutionScope(userId: string, userRoles: string[], institutionId: string) {
    if (userRoles.includes('SUPER_ADMIN')) {
      return;
    }

    const adminRecord = await this.prisma.institutionAdmin.findFirst({
      where: { userId, isActive: true },
    });

    if (adminRecord && adminRecord.institutionId !== institutionId) {
      throw new ForbiddenException(
        'Access denied. You are not authorized to manage billing for this school.',
      );
    }
  }

  /**
   * ── INVOICE PREVIEW ─────────────────────────────────────────────
   * Calculates live student count and total based on current price.
   */
  async getInvoicePreview(institutionId: string, billingMonth: number, billingYear: number) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, name: true, code: true, email: true, phone: true, city: true },
    });

    if (!institution) {
      throw new NotFoundException(`School/Institution '${institutionId}' not found.`);
    }

    const studentCount = await this.countEligibleStudents(institutionId);
    const pricePerStudent = await this.getPricingSetting();
    const totalAmount = studentCount * pricePerStudent;

    const existingInvoice = await this.prisma.bill.findUnique({
      where: {
        institutionId_billingYear_billingMonth: {
          institutionId,
          billingYear,
          billingMonth,
        },
      },
      select: { id: true, billNumber: true, totalAmount: true, status: true, emailStatus: true },
    });

    return {
      institution,
      billingMonth,
      billingYear,
      periodLabel: `${MONTH_NAMES[billingMonth]} ${billingYear}`,
      studentCount,
      pricePerStudent,
      totalAmount,
      alreadyGenerated: Boolean(existingInvoice),
      existingInvoice,
    };
  }

  /**
   * ── GENERATE SCHOOL INVOICE ─────────────────────────────────────
   * Generates invoice for a specific school and billing period.
   * Stores price snapshot (pricePerStudent) and studentCount.
   */
  async generateInvoice(dto: GenerateInvoiceDto, userId: string) {
    const { institutionId, billingMonth, billingYear } = dto;

    if (!institutionId) {
      throw new BadRequestException('School/Institution is required for single invoice generation.');
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });

    if (!institution) {
      throw new NotFoundException(`School/Institution '${institutionId}' not found.`);
    }

    // Duplicate invoice protection
    const existing = await this.prisma.bill.findUnique({
      where: {
        institutionId_billingYear_billingMonth: {
          institutionId,
          billingYear,
          billingMonth,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Invoice for ${institution.name} for ${MONTH_NAMES[billingMonth]} ${billingYear} already exists (${existing.billNumber}).`,
      );
    }

    // Dynamic eligible student count
    const studentCount = await this.countEligibleStudents(institutionId);
    if (studentCount === 0) {
      throw new BadRequestException(
        `Cannot generate invoice: School '${institution.name}' has no eligible active students for ${MONTH_NAMES[billingMonth]} ${billingYear}.`,
      );
    }

    // Current price snapshot
    const pricePerStudent = await this.getPricingSetting();
    const amount = studentCount * pricePerStudent;
    const tax = 0;
    const totalAmount = amount;

    const billNumber = await this.generateInvoiceNumber(billingYear, billingMonth);
    const periodLabel = `${MONTH_NAMES[billingMonth]} ${billingYear}`;

    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          billNumber,
          institutionId,
          createdById: userId,
          billDate: new Date(),
          billingMonth,
          billingYear,
          studentCount,
          pricePerStudent,
          amount,
          tax,
          totalAmount,
          status: 'GENERATED',
          emailStatus: 'IDLE',
          description: `Student Platform Subscription (${periodLabel})`,
        },
        include: {
          institution: { select: { id: true, name: true, code: true, email: true, phone: true } },
          createdBy: { select: { id: true, name: true, mobileNumber: true, email: true } },
        },
      });

      // Audit Log for Invoice Generation
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'INVOICE_GENERATED',
          entityType: 'BILL',
          entityId: bill.id,
          afterState: {
            billNumber: bill.billNumber,
            institutionId: bill.institutionId,
            billingMonth,
            billingYear,
            studentCount,
            pricePerStudent,
            totalAmount,
            status: 'GENERATED',
          },
          metadata: {
            schoolName: institution.name,
            studentCount,
            pricePerStudent,
            totalAmount,
            billingPeriod: periodLabel,
          },
        },
      });

      this.logger.log(
        `Generated invoice ${billNumber} for ${institution.name}: ${studentCount} students × ₹${pricePerStudent} = ₹${totalAmount}`,
      );

      return bill;
    });
  }

  /**
   * ── BULK INVOICE GENERATION ─────────────────────────────────────
   * Generates invoices for all active institutions for a billing month/year.
   * Reports live WebSocket progress through JobProgressService.
   */
  async generateBulkInvoices(dto: GenerateInvoiceDto, userId: string) {
    const { billingMonth, billingYear } = dto;
    const periodLabel = `${MONTH_NAMES[billingMonth]} ${billingYear}`;
    const pricePerStudent = await this.getPricingSetting();

    const institutions = await this.prisma.institution.findMany({
      where: { status: { in: ['ACTIVE', 'APPROVED'] } },
      orderBy: { name: 'asc' },
    });

    const totalSchools = institutions.length;
    const jobId = `bulk_invoice_${billingYear}_${billingMonth}_${Date.now()}`;

    await this.jobProgressService.publishStarted(
      'bulk-invoices',
      jobId,
      'INVOICE_GENERATION',
      `Generating invoices for ${totalSchools} schools (${periodLabel})...`,
      { totalSchools, billingMonth, billingYear, pricePerStudent },
    );

    let generatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Process iteratively with real-time WebSocket progress
    for (let i = 0; i < totalSchools; i++) {
      const inst = institutions[i];
      try {
        const existing = await this.prisma.bill.findUnique({
          where: {
            institutionId_billingYear_billingMonth: {
              institutionId: inst.id,
              billingYear,
              billingMonth,
            },
          },
        });

        if (existing) {
          skippedCount++;
        } else {
          const studentCount = await this.countEligibleStudents(inst.id);
          if (studentCount === 0) {
            skippedCount++;
          } else {
            const amount = studentCount * pricePerStudent;
            const totalAmount = amount;
            const billNumber = await this.generateInvoiceNumber(billingYear, billingMonth);

            await this.prisma.bill.create({
              data: {
                billNumber,
                institutionId: inst.id,
                createdById: userId,
                billDate: new Date(),
                billingMonth,
                billingYear,
                studentCount,
                pricePerStudent,
                amount,
                tax: 0,
                totalAmount,
                status: 'GENERATED',
                emailStatus: 'IDLE',
                description: `Student Platform Subscription (${periodLabel})`,
              },
            });

            generatedCount++;
          }
        }
      } catch (err: any) {
        errors.push(`${inst.name}: ${err.message}`);
      }

      await this.jobProgressService.publishProgress(
        'bulk-invoices',
        jobId,
        i + 1,
        totalSchools,
        {
          stage: 'GENERATING_INVOICES',
          message: `${i + 1} / ${totalSchools} schools processed (${Math.round(((i + 1) / totalSchools) * 100)}%)`,
          currentSchool: inst.name,
        },
      );
    }

    await this.jobProgressService.publishCompleted(
      'bulk-invoices',
      jobId,
      `Invoice generation completed: ${generatedCount} generated, ${skippedCount} skipped.`,
      { generatedCount, skippedCount, errorsCount: errors.length },
    );

    return {
      jobId,
      totalSchools,
      generatedCount,
      skippedCount,
      errors,
    };
  }

  /**
   * ── CREATE MANUAL BILL (Staff / Legacy) ─────────────────────────
   */
  async createBill(dto: CreateBillDto, userId: string, userRoles: string[]) {
    await this.assertInstitutionScope(userId, userRoles, dto.institutionId);

    const institution = await this.prisma.institution.findUnique({
      where: { id: dto.institutionId },
    });

    if (!institution) {
      throw new NotFoundException(`School/Institution '${dto.institutionId}' not found.`);
    }

    const amount = Number(dto.amount);
    const tax = Number(dto.tax || 0);
    const totalAmount = Math.round((amount + tax) * 100) / 100;

    const billNumber = await this.generateBillNumber();
    const billDate = dto.billDate ? new Date(dto.billDate) : new Date();
    const initialStatus = dto.submitImmediately ? 'PENDING_APPROVAL' : 'DRAFT';

    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          billNumber,
          institutionId: dto.institutionId,
          createdById: userId,
          billDate,
          description: dto.description.trim(),
          amount,
          tax,
          totalAmount,
          status: initialStatus as any,
          emailStatus: 'IDLE',
        },
        include: {
          institution: { select: { id: true, name: true, code: true, email: true } },
          createdBy: { select: { id: true, name: true, mobileNumber: true, email: true } },
        },
      });

      // Audit Log for Bill creation
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'BILL_CREATED',
          entityType: 'BILL',
          entityId: bill.id,
          afterState: {
            billNumber: bill.billNumber,
            institutionId: bill.institutionId,
            totalAmount: bill.totalAmount,
            status: bill.status,
          },
          metadata: {
            schoolName: institution.name,
            amount,
            tax,
            totalAmount,
            status: initialStatus,
          },
        },
      });

      if (dto.submitImmediately) {
        await tx.approvalRequest.create({
          data: {
            resourceType: 'BILL',
            resourceId: bill.id,
            requestedById: userId,
            status: 'PENDING',
            metadata: {
              billNumber: bill.billNumber,
              schoolName: institution.name,
              totalAmount: bill.totalAmount,
              submittedAt: new Date().toISOString(),
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'BILL_SUBMITTED',
            entityType: 'BILL',
            entityId: bill.id,
            afterState: { status: 'PENDING_APPROVAL' },
            metadata: { billNumber: bill.billNumber },
          },
        });
      }

      this.logger.log(`Bill '${bill.billNumber}' created with status '${initialStatus}' by '${userId}'`);
      return bill;
    });
  }

  /**
   * ── SUBMIT DRAFT BILL ──────────────────────────────────────────
   */
  async submitBill(billId: string, userId: string, userRoles: string[]) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { institution: true },
    });

    if (!bill) {
      throw new NotFoundException(`Bill '${billId}' not found.`);
    }

    if (!userRoles.includes('SUPER_ADMIN') && bill.createdById !== userId) {
      throw new ForbiddenException('You are not authorized to submit this bill.');
    }

    if (bill.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot submit bill with status '${bill.status}'. Only DRAFT bills can be submitted.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bill.update({
        where: { id: billId },
        data: { status: 'PENDING_APPROVAL' },
        include: {
          institution: { select: { id: true, name: true, code: true, email: true } },
          createdBy: { select: { id: true, name: true, mobileNumber: true, email: true } },
        },
      });

      await tx.approvalRequest.create({
        data: {
          resourceType: 'BILL',
          resourceId: bill.id,
          requestedById: userId,
          status: 'PENDING',
          metadata: {
            billNumber: bill.billNumber,
            schoolName: bill.institution.name,
            totalAmount: bill.totalAmount,
            submittedAt: new Date().toISOString(),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'BILL_SUBMITTED',
          entityType: 'BILL',
          entityId: bill.id,
          beforeState: { status: 'DRAFT' },
          afterState: { status: 'PENDING_APPROVAL' },
          metadata: { billNumber: bill.billNumber },
        },
      });

      return updated;
    });
  }

  /**
   * ── LIST BILLS / INVOICES ───────────────────────────────────────
   * Server-side pagination, whitelist sorting, and multi-field filtering.
   * Default sorting: Created At DESC (recent-first).
   */
  async listBills(filter: BillFilterDto, userId: string, userRoles: string[]) {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Scope enforcement for non-Super Admin
    if (!userRoles.includes('SUPER_ADMIN')) {
      const adminRecord = await this.prisma.institutionAdmin.findFirst({
        where: { userId, isActive: true },
      });
      if (adminRecord) {
        where.institutionId = adminRecord.institutionId;
      } else {
        where.createdById = userId;
      }
    } else if (filter.institutionId) {
      where.institutionId = filter.institutionId;
    }

    if (filter.status && filter.status !== 'ALL') {
      where.status = filter.status.toUpperCase();
    }

    if (filter.month) {
      where.billingMonth = Number(filter.month);
    }

    if (filter.year) {
      where.billingYear = Number(filter.year);
    }

    if (filter.search && filter.search.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { billNumber: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { institution: { name: { contains: q, mode: 'insensitive' } } },
        { institution: { code: { contains: q, mode: 'insensitive' } } },
        { createdBy: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    if (filter.from || filter.to) {
      where.billDate = {};
      if (filter.from) where.billDate.gte = new Date(filter.from);
      if (filter.to) where.billDate.lte = new Date(filter.to);
    }

    // Whitelist sorting fields
    const allowedSortFields: Record<string, string> = {
      createdAt: 'createdAt',
      billDate: 'billDate',
      totalAmount: 'totalAmount',
      studentCount: 'studentCount',
      billNumber: 'billNumber',
      billingMonth: 'billingMonth',
      billingYear: 'billingYear',
    };

    const sortBy = filter.sortBy && allowedSortFields[filter.sortBy] ? allowedSortFields[filter.sortBy] : 'createdAt';
    const sortOrder = (filter.sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';

    const [bills, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          institution: { select: { id: true, name: true, code: true, email: true, phone: true, city: true, address: true } },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              mobileNumber: true,
              userRoles: { include: { role: true } },
            },
          },
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.bill.count({ where }),
    ]);

    const items = bills.map((b) => {
      const staffRole = b.createdBy?.userRoles?.[0]?.role?.name || 'STAFF';
      return {
        id: b.id,
        billNumber: b.billNumber,
        billDate: b.billDate,
        billingMonth: b.billingMonth,
        billingYear: b.billingYear,
        billingPeriod:
          b.billingMonth && b.billingYear
            ? `${MONTH_NAMES[b.billingMonth] || 'Month ' + b.billingMonth} ${b.billingYear}`
            : null,
        studentCount: b.studentCount,
        pricePerStudent: b.pricePerStudent,
        description: b.description,
        amount: b.amount,
        tax: b.tax,
        totalAmount: b.totalAmount,
        status: b.status,
        rejectionReason: b.rejectionReason,
        emailStatus: b.emailStatus || 'IDLE',
        emailFailedReason: b.emailFailedReason,
        sentAt: b.sentAt,
        institution: b.institution,
        createdBy: {
          id: b.createdBy.id,
          name: b.createdBy.name || 'Staff Member',
          email: b.createdBy.email,
          mobileNumber: b.createdBy.mobileNumber,
          role: staffRole,
        },
        approvedBy: b.approvedBy ? { id: b.approvedBy.id, name: b.approvedBy.name || b.approvedBy.email } : null,
        approvedAt: b.approvedAt,
        createdAt: b.createdAt,
      };
    });

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * ── GET BILL BY ID ──────────────────────────────────────────────
   */
  async getBillById(billId: string, userId: string, userRoles: string[]) {
    const b = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        institution: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            mobileNumber: true,
            userRoles: { include: { role: true } },
          },
        },
        approvedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!b) {
      throw new NotFoundException(`Bill/Invoice '${billId}' not found.`);
    }

    if (!userRoles.includes('SUPER_ADMIN')) {
      await this.assertInstitutionScope(userId, userRoles, b.institutionId);
    }

    const staffRole = b.createdBy?.userRoles?.[0]?.role?.name || 'STAFF';

    return {
      id: b.id,
      billNumber: b.billNumber,
      billDate: b.billDate,
      billingMonth: b.billingMonth,
      billingYear: b.billingYear,
      billingPeriod:
        b.billingMonth && b.billingYear
          ? `${MONTH_NAMES[b.billingMonth] || 'Month ' + b.billingMonth} ${b.billingYear}`
          : null,
      studentCount: b.studentCount,
      pricePerStudent: b.pricePerStudent,
      description: b.description,
      amount: b.amount,
      tax: b.tax,
      totalAmount: b.totalAmount,
      status: b.status,
      rejectionReason: b.rejectionReason,
      emailStatus: b.emailStatus || 'IDLE',
      emailFailedReason: b.emailFailedReason,
      sentAt: b.sentAt,
      institution: b.institution,
      createdBy: {
        id: b.createdBy.id,
        name: b.createdBy.name || 'Staff Member',
        email: b.createdBy.email,
        mobileNumber: b.createdBy.mobileNumber,
        role: staffRole,
      },
      approvedBy: b.approvedBy ? { id: b.approvedBy.id, name: b.approvedBy.name || b.approvedBy.email } : null,
      approvedAt: b.approvedAt,
      createdAt: b.createdAt,
    };
  }

  /**
   * ── UPDATE DRAFT BILL ──────────────────────────────────────────
   */
  async updateBill(billId: string, dto: UpdateBillDto, userId: string, userRoles: string[]) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) {
      throw new NotFoundException(`Bill '${billId}' not found.`);
    }

    if (!userRoles.includes('SUPER_ADMIN') && bill.createdById !== userId) {
      throw new ForbiddenException('You are not authorized to modify this bill.');
    }

    if (bill.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot update bill in '${bill.status}' status. Only DRAFT bills can be edited.`,
      );
    }

    const amount = dto.amount !== undefined ? Number(dto.amount) : bill.amount;
    const tax = dto.tax !== undefined ? Number(dto.tax) : bill.tax;
    const totalAmount = Math.round((amount + tax) * 100) / 100;

    return this.prisma.bill.update({
      where: { id: billId },
      data: {
        description: dto.description !== undefined ? dto.description.trim() : bill.description,
        amount,
        tax,
        totalAmount,
        billDate: dto.billDate ? new Date(dto.billDate) : bill.billDate,
      },
    });
  }

  /**
   * ── APPROVE BILL ───────────────────────────────────────────────
   */
  async approveBill(billId: string, reviewerId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { institution: true, createdBy: true },
    });

    if (!bill) {
      throw new NotFoundException(`Bill '${billId}' not found.`);
    }

    if (bill.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot approve bill with status '${bill.status}'. Only PENDING_APPROVAL bills can be approved.`,
      );
    }

    if (bill.createdById === reviewerId) {
      throw new ForbiddenException('Staff members cannot approve their own bills.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'APPROVED',
          approvedById: reviewerId,
          approvedAt: new Date(),
          rejectionReason: null,
        },
      });

      await tx.approvalRequest.updateMany({
        where: { resourceType: 'BILL', resourceId: billId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: reviewerId,
          action: 'BILL_APPROVED',
          entityType: 'BILL',
          entityId: bill.id,
          beforeState: { status: 'PENDING_APPROVAL' },
          afterState: { status: 'APPROVED', approvedBy: reviewerId },
          metadata: { billNumber: bill.billNumber },
        },
      });

      return updated;
    });
  }

  /**
   * ── REJECT BILL ────────────────────────────────────────────────
   */
  async rejectBill(billId: string, reviewerId: string, dto: RejectBillDto) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Rejection reason is mandatory.');
    }

    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { institution: true },
    });

    if (!bill) {
      throw new NotFoundException(`Bill '${billId}' not found.`);
    }

    if (bill.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot reject bill with status '${bill.status}'. Only PENDING_APPROVAL bills can be rejected.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'REJECTED',
          approvedById: reviewerId,
          approvedAt: new Date(),
          rejectionReason: dto.reason.trim(),
        },
      });

      await tx.approvalRequest.updateMany({
        where: { resourceType: 'BILL', resourceId: billId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: dto.reason.trim(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: reviewerId,
          action: 'BILL_REJECTED',
          entityType: 'BILL',
          entityId: bill.id,
          beforeState: { status: 'PENDING_APPROVAL' },
          afterState: { status: 'REJECTED', rejectionReason: dto.reason.trim() },
          reason: dto.reason.trim(),
          metadata: { billNumber: bill.billNumber },
        },
      });

      return updated;
    });
  }

  /**
   * ── DISPATCH INVOICE VIA EMAIL (BullMQ + Resend) ───────────────
   * Resolves recipient email from school record.
   * Prevents duplicate accidental clicks.
   */
  async sendBill(billId: string, currentUserId: string, explicitRecipientEmail?: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { institution: true },
    });

    if (!bill) {
      throw new NotFoundException(`Invoice '${billId}' not found.`);
    }

    // School email must be resolved server-side from school record
    const recipientEmail = explicitRecipientEmail || bill.institution.email;
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new BadRequestException('School email is not configured.');
    }

    // Duplicate email protection
    if (bill.emailStatus === 'QUEUED' || bill.emailStatus === 'PROCESSING') {
      throw new BadRequestException('An email dispatch job is already in progress for this invoice.');
    }

    // Mark as QUEUED in DB
    await this.prisma.bill.update({
      where: { id: bill.id },
      data: { emailStatus: 'QUEUED', emailFailedReason: null },
    });

    let jobId = `bill_email_${bill.id}_${Date.now()}`;
    try {
      const job = await this.billEmailQueue.add(
        'send-bill-email',
        {
          billId: bill.id,
          recipientEmail,
          schoolName: bill.institution.name,
          requestedById: currentUserId,
        },
        {
          jobId,
          removeOnComplete: true,
        },
      );
      if (job?.id) jobId = job.id;
    } catch (queueErr: any) {
      this.logger.warn(
        `[BillingService] BullMQ queue unavailable (${queueErr.message || queueErr}). Falling back to asynchronous direct dispatch.`,
      );

      setImmediate(async () => {
        try {
          const processor = this.moduleRef?.get(BillEmailProcessor, { strict: false });
          if (processor) {
            await processor.process({
              id: jobId,
              name: 'send-bill-email',
              data: {
                billId: bill.id,
                recipientEmail,
                schoolName: bill.institution.name,
                requestedById: currentUserId,
              },
            } as any);
          }
        } catch (err: any) {
          this.logger.error(`[BillingService] Direct bill email dispatch failed: ${err.message || err}`);
        }
      });
    }

    // Audit Log for email dispatch request
    await this.prisma.auditLog.create({
      data: {
        actorUserId: currentUserId,
        action: 'BILL_EMAIL_QUEUED',
        entityType: 'BILL',
        entityId: bill.id,
        metadata: {
          billNumber: bill.billNumber,
          recipientEmail,
          jobId,
        },
      },
    });

    return {
      message: `Invoice email queued for delivery to ${bill.institution.name} (${recipientEmail}).`,
      jobId,
      emailStatus: 'QUEUED',
    };
  }

  /**
   * ── RETRY FAILED INVOICE EMAIL ──────────────────────────────────
   */
  async retryBillEmail(billId: string, currentUserId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { institution: true },
    });

    if (!bill) {
      throw new NotFoundException(`Invoice '${billId}' not found.`);
    }

    // Reset failed state and re-dispatch
    await this.prisma.bill.update({
      where: { id: bill.id },
      data: { emailStatus: 'IDLE', emailFailedReason: null },
    });

    return this.sendBill(bill.id, currentUserId);
  }

  /**
   * ── DOWNLOAD / STREAM INVOICE PDF ──────────────────────────────
   */
  async getBillPdfBuffer(
    billId: string,
    userId: string,
    userRoles: string[],
  ): Promise<{ filename: string; buffer: Buffer }> {
    const bill = await this.getBillById(billId, userId, userRoles);

    const buffer = await this.pdfService.generateBillPdf({
      billNumber: bill.billNumber,
      billDate: bill.billDate,
      billingMonth: bill.billingMonth,
      billingYear: bill.billingYear,
      schoolName: bill.institution.name,
      schoolCode: bill.institution.code,
      schoolEmail: bill.institution.email,
      schoolPhone: bill.institution.phone,
      schoolAddress: bill.institution.address,
      studentCount: bill.studentCount,
      pricePerStudent: bill.pricePerStudent,
      description: bill.description,
      amount: bill.amount,
      tax: bill.tax,
      totalAmount: bill.totalAmount,
      status: bill.status,
      createdByName: bill.createdBy.name,
      approvedByName: bill.approvedBy?.name,
      approvedAt: bill.approvedAt,
    });

    const filename = `Invoice_${bill.billNumber}_${bill.institution.code}.pdf`;
    return { filename, buffer };
  }

  /**
   * ── DYNAMIC FILTER OPTIONS ─────────────────────────────────────
   * Supplies dynamic years, months, schools, and current price setting.
   */
  async getFilterOptions() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const distinctBills = await this.prisma.bill.findMany({
      where: { billingYear: { not: null } },
      select: { billingYear: true, billingMonth: true },
      distinct: ['billingYear', 'billingMonth'],
    });

    const yearsSet = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
    for (const b of distinctBills) {
      if (b.billingYear) yearsSet.add(b.billingYear);
    }
    const availableYears = Array.from(yearsSet).sort((a, b) => b - a);

    const months = [
      { month: 1, name: 'January' },
      { month: 2, name: 'February' },
      { month: 3, name: 'March' },
      { month: 4, name: 'April' },
      { month: 5, name: 'May' },
      { month: 6, name: 'June' },
      { month: 7, name: 'July' },
      { month: 8, name: 'August' },
      { month: 9, name: 'September' },
      { month: 10, name: 'October' },
      { month: 11, name: 'November' },
      { month: 12, name: 'December' },
    ];

    const schools = await this.prisma.institution.findMany({
      where: { status: { in: ['ACTIVE', 'APPROVED', 'DRAFT'] } },
      select: { id: true, name: true, code: true, email: true, city: true },
      orderBy: { name: 'asc' },
    });

    const currentPrice = await this.getPricingSetting();

    const lastMonthDate = new Date(currentYear, currentMonth - 2, 1);
    const lastMonth = lastMonthDate.getMonth() + 1;
    const lastMonthYear = lastMonthDate.getFullYear();

    return {
      availableYears,
      months,
      schools,
      currentPrice,
      currentMonth,
      currentYear,
      lastMonth,
      lastMonthYear,
    };
  }

  /**
   * ── SCHOOLS DROPDOWN ───────────────────────────────────────────
   */
  async getSchoolsDropdown(userId: string, userRoles: string[]) {
    if (userRoles.includes('SUPER_ADMIN')) {
      return this.prisma.institution.findMany({
        where: { status: { in: ['ACTIVE', 'DRAFT', 'APPROVED'] as any } },
        select: { id: true, name: true, code: true, email: true, phone: true, city: true },
        orderBy: { name: 'asc' },
      });
    }

    const adminRecord = await this.prisma.institutionAdmin.findFirst({
      where: { userId, isActive: true },
      include: { institution: { select: { id: true, name: true, code: true, email: true, phone: true, city: true } } },
    });

    if (adminRecord) {
      return [adminRecord.institution];
    }

    return this.prisma.institution.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, code: true, email: true, phone: true, city: true },
      orderBy: { name: 'asc' },
    });
  }
}

