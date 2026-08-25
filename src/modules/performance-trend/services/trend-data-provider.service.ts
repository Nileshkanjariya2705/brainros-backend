import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetTrendsQueryDto } from '../dto/performance-trend.dto';

@Injectable()
export class TrendDataProviderService {
  private readonly logger = new Logger(TrendDataProviderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load all completed/evaluated mock attempts for a student matching filters in a single query
   */
  async loadStudentMockAttempts(studentId: string, filters: GetTrendsQueryDto) {
    const whereClause: any = {
      studentId,
      result: { isNot: null }, // Only evaluated attempts
      status: { code: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
    };

    // Filter by examId
    if (filters.examId) {
      whereClause.examId = filters.examId;
    }

    // Filter by examType
    if (filters.examType) {
      whereClause.exam = {
        examTarget: {
          name: { equals: filters.examType, mode: 'insensitive' },
        },
      };
    }

    // Filter by date range
    if (filters.from || filters.to) {
      whereClause.createdAt = {};
      if (filters.from) whereClause.createdAt.gte = new Date(filters.from);
      if (filters.to) whereClause.createdAt.lte = new Date(filters.to);
    }

    const attempts = await this.prisma.attempt.findMany({
      where: whereClause,
      include: {
        exam: {
          include: { examTarget: true },
        },
        result: {
          include: {
            subjectResults: {
              include: { subject: true },
            },
          },
        },
        candidateRanks: {
          where: { rankType: 'OVERALL' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        timeAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' }, // Chronological order
      take: filters.limit || 10,
    });

    this.logger.debug(`Loaded ${attempts.length} evaluated mock attempts for student '${studentId}'`);
    return attempts;
  }
}
