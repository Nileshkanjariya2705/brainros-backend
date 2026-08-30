import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBatchDto, UpdateBatchDto } from '../dto/institution.dto';

@Injectable()
export class InstitutionBatchService {
  private readonly logger = new Logger(InstitutionBatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a batch within an institution.
   */
  async create(
    institutionId: string,
    dto: CreateBatchDto,
    createdById: string,
  ) {
    // Institution must be ACTIVE
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (!institution || institution.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Batches can only be created for ACTIVE institutions.',
      );
    }

    return this.prisma.institutionBatch.create({
      data: {
        institutionId,
        name: dto.name,
        academicYear: dto.academicYear,
        examTargetId: dto.examTargetId,
        classLevel: dto.classLevel,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        createdById,
      },
    });
  }

  /**
   * List batches for an institution.
   */
  async findByInstitution(institutionId: string, status?: string) {
    const where: any = { institutionId };
    if (status) where.status = status;

    return this.prisma.institutionBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        examTarget: { select: { id: true, name: true } },
        _count: { select: { students: true } },
      },
    });
  }

  /**
   * Get a single batch with student count.
   */
  async findById(batchId: string) {
    const batch = await this.prisma.institutionBatch.findUnique({
      where: { id: batchId },
      include: {
        examTarget: { select: { id: true, name: true } },
        _count: { select: { students: true } },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch '${batchId}' not found.`);
    }

    return batch;
  }

  /**
   * Update a batch.
   */
  async update(batchId: string, dto: UpdateBatchDto) {
    return this.prisma.institutionBatch.update({
      where: { id: batchId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.status && { status: dto.status as any }),
        ...(dto.academicYear && { academicYear: dto.academicYear }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
      },
    });
  }

  /**
   * Add a student to a batch.
   */
  async addStudent(batchId: string, studentId: string) {
    const batch = await this.prisma.institutionBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch || ['ARCHIVED', 'CANCELLED'].includes(batch.status)) {
      throw new BadRequestException(
        'Cannot assign students to an ARCHIVED or CANCELLED batch.',
      );
    }

    // Verify student exists
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student '${studentId}' not found.`);
    }

    // Upsert: reactivate if previously LEFT/REMOVED
    return this.prisma.batchStudent.upsert({
      where: {
        batchId_studentId: { batchId, studentId },
      },
      update: {
        status: 'ACTIVE',
        joinedAt: new Date(),
        leftAt: null,
      },
      create: {
        batchId,
        studentId,
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Remove a student from a batch (soft removal — preserves history).
   */
  async removeStudent(batchId: string, studentId: string) {
    const membership = await this.prisma.batchStudent.findUnique({
      where: { batchId_studentId: { batchId, studentId } },
    });

    if (!membership) {
      throw new NotFoundException('Student is not a member of this batch.');
    }

    return this.prisma.batchStudent.update({
      where: { id: membership.id },
      data: {
        status: 'REMOVED',
        leftAt: new Date(),
      },
    });
  }

  /**
   * List students in a batch.
   */
  async listStudents(batchId: string, status?: string) {
    const where: any = { batchId };
    if (status) where.status = status;

    return this.prisma.batchStudent.findMany({
      where,
      orderBy: { joinedAt: 'desc' },
      include: {
        student: {
          include: {
            examTarget: { select: { id: true, name: true } },
            studentClass: { select: { id: true, name: true } },
          },
        },
      },
    });
  }
}
