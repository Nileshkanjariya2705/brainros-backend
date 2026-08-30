import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExamCycleDto, UpdateExamCycleDto } from '../dto/calendar.dto';

@Injectable()
export class ExamCycleService {
  private readonly logger = new Logger(ExamCycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCycle(dto: CreateExamCycleDto, createdById: string) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (start >= end) {
      throw new BadRequestException(
        'Cycle startDate must be strictly before endDate.',
      );
    }

    return this.prisma.examCycle.create({
      data: {
        name: dto.name,
        academicYear: dto.academicYear,
        startDate: start,
        endDate: end,
        status: 'DRAFT',
        createdById,
      },
    });
  }

  async getCycles() {
    return this.prisma.examCycle.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { events: true } },
      },
    });
  }

  async getCycleById(id: string) {
    const cycle = await this.prisma.examCycle.findUnique({
      where: { id },
      include: {
        events: {
          include: {
            exam: {
              select: {
                id: true,
                title: true,
                durationMinutes: true,
                totalQuestions: true,
              },
            },
          },
          orderBy: { plannedStartTime: 'asc' },
        },
      },
    });

    if (!cycle) {
      throw new NotFoundException(`Exam cycle '${id}' not found.`);
    }

    return cycle;
  }

  async updateCycle(id: string, dto: UpdateExamCycleDto) {
    const existing = await this.prisma.examCycle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Exam cycle '${id}' not found.`);
    }

    const data: any = {};
    if (dto.name) data.name = dto.name;
    if (dto.status) data.status = dto.status;
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);

    if (data.startDate && data.endDate && data.startDate >= data.endDate) {
      throw new BadRequestException('Cycle startDate must be before endDate.');
    }

    return this.prisma.examCycle.update({
      where: { id },
      data,
    });
  }
}
