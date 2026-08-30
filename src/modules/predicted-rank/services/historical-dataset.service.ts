import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHistoricalExamDto,
  ImportHistoricalDatasetDto,
} from '../dto/predicted-rank.dto';
import {
  DatasetQualityReport,
  DataQualityStatusEnum,
} from '../interfaces/predicted-rank.interface';

@Injectable()
export class HistoricalDatasetService {
  private readonly logger = new Logger(HistoricalDatasetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new Historical Exam record
   */
  async createHistoricalExam(dto: CreateHistoricalExamDto) {
    const exam = await this.prisma.historicalExam.create({
      data: {
        examName: dto.examName,
        examType: dto.examType.toUpperCase(),
        examDate: dto.examDate ? new Date(dto.examDate) : null,
        durationMinutes: dto.durationMinutes || 180,
        totalMarks: dto.totalMarks,
        totalCandidates: dto.totalCandidates,
        source: dto.source || 'INTERNAL_RESULTS',
        dataQualityStatus: 'PENDING_VALIDATION',
      },
    });

    this.logger.log(`Created historical exam '${exam.id}' (${exam.examName})`);
    return exam;
  }

  /**
   * List all historical exams with dataset stats
   */
  async getHistoricalExams(examType?: string) {
    const where: any = {};
    if (examType) where.examType = examType.toUpperCase();

    return this.prisma.historicalExam.findMany({
      where,
      include: {
        _count: {
          select: {
            datasets: true,
            scoreRanges: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get single historical exam with score ranges
   */
  async getHistoricalExamById(id: string) {
    const exam = await this.prisma.historicalExam.findUnique({
      where: { id },
      include: {
        scoreRanges: {
          orderBy: { minScore: 'asc' },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Historical exam '${id}' not found`);
    }

    return exam;
  }

  /**
   * Ingest / Replace score ranges for a historical exam and trigger quality validation
   */
  async importScoreRanges(id: string, dto: ImportHistoricalDatasetDto) {
    const exam = await this.prisma.historicalExam.findUnique({
      where: { id },
    });
    if (!exam) {
      throw new NotFoundException(`Historical exam '${id}' not found`);
    }

    // Replace score ranges in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.historicalScoreRange.deleteMany({
        where: { historicalExamId: id },
      });

      await tx.historicalScoreRange.createMany({
        data: dto.scoreRanges.map((r) => ({
          historicalExamId: id,
          minScore: r.minScore,
          maxScore: r.maxScore,
          representativeScore:
            r.representativeScore ?? (r.minScore + r.maxScore) / 2,
          minRank: r.minRank,
          maxRank: r.maxRank,
          candidateCount: r.candidateCount,
          totalCandidates: exam.totalCandidates,
          percentileMin: r.percentileMin ?? null,
          percentileMax: r.percentileMax ?? null,
          datasetVersion: exam.datasetVersion,
        })),
      });
    });

    // Run quality validation
    const qualityReport = await this.validateDataset(id);

    return {
      message: `Successfully imported ${dto.scoreRanges.length} score ranges`,
      historicalExamId: id,
      dataQualityStatus: qualityReport.status,
      qualityScore: qualityReport.qualityScore,
      isMonotonic: qualityReport.isMonotonic,
    };
  }

  /**
   * Run comprehensive Dataset Quality Validation
   */
  async validateDataset(id: string): Promise<DatasetQualityReport> {
    const exam = await this.prisma.historicalExam.findUnique({
      where: { id },
      include: {
        scoreRanges: {
          orderBy: { minScore: 'asc' },
        },
      },
    });
    if (!exam) {
      throw new NotFoundException(`Historical exam '${id}' not found`);
    }

    const ranges = exam.scoreRanges;
    const issues: string[] = [];
    let validRecords = 0;
    let invalidRecords = 0;
    let isMonotonic = true;

    if (ranges.length === 0) {
      issues.push('No score ranges imported.');
      await this.prisma.historicalExam.update({
        where: { id },
        data: { dataQualityStatus: 'INVALID', qualityScore: 0 },
      });
      return {
        historicalExamId: id,
        status: 'INVALID',
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        duplicateRecords: 0,
        minScore: 0,
        maxScore: 0,
        isMonotonic: false,
        scoreCoveragePercentage: 0,
        qualityScore: 0,
        issues,
      };
    }

    // 1. Check score and rank bounds
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      let rowValid = true;

      if (
        r.minScore < 0 ||
        r.maxScore > exam.totalMarks ||
        r.minScore > r.maxScore
      ) {
        issues.push(`Range ${r.minScore}-${r.maxScore}: Score bounds invalid`);
        rowValid = false;
      }
      if (
        r.minRank < 1 ||
        r.maxRank > exam.totalCandidates ||
        r.minRank > r.maxRank
      ) {
        issues.push(`Range ${r.minScore}-${r.maxScore}: Rank bounds invalid`);
        rowValid = false;
      }

      if (rowValid) validRecords++;
      else invalidRecords++;

      // 2. Monotonicity check: as score increases (next element), rank must decrease or stay equal
      if (i > 0) {
        const prev = ranges[i - 1];
        if (r.minRank > prev.maxRank) {
          isMonotonic = false;
          issues.push(
            `Inverted Monotonicity: Score ${r.minScore} has rank ${r.minRank} which is worse than lower score ${prev.minScore} rank ${prev.maxRank}`,
          );
        }
      }
    }

    // 3. Score coverage percentage
    const minObserved = ranges[0].minScore;
    const maxObserved = ranges[ranges.length - 1].maxScore;
    const coveredSpan = maxObserved - minObserved;
    const scoreCoveragePercentage =
      exam.totalMarks > 0
        ? Math.min(
            100,
            Math.round((coveredSpan / exam.totalMarks) * 10000) / 100,
          )
        : 0;

    // 4. Compute Quality Score (0 - 100)
    let qualityScore = 100;
    if (!isMonotonic) qualityScore -= 40;
    if (invalidRecords > 0)
      qualityScore -= (invalidRecords / ranges.length) * 30;
    if (scoreCoveragePercentage < 60) qualityScore -= 20;

    qualityScore = Math.max(
      0,
      Math.min(100, Math.round(qualityScore * 10) / 10),
    );

    const status: DataQualityStatusEnum =
      qualityScore >= 80 && isMonotonic
        ? 'VALID'
        : qualityScore >= 50
          ? 'PARTIALLY_VALID'
          : 'INVALID';

    await this.prisma.historicalExam.update({
      where: { id },
      data: {
        dataQualityStatus: status,
        qualityScore,
      },
    });

    return {
      historicalExamId: id,
      status,
      totalRecords: ranges.length,
      validRecords,
      invalidRecords,
      duplicateRecords: 0,
      minScore: minObserved,
      maxScore: maxObserved,
      isMonotonic,
      scoreCoveragePercentage,
      qualityScore,
      issues,
    };
  }
}
