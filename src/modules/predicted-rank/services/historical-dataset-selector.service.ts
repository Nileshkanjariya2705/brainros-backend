import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SelectedHistoricalDataset } from '../interfaces/predicted-rank.interface';

@Injectable()
export class HistoricalDatasetSelectorService {
  private readonly logger = new Logger(HistoricalDatasetSelectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Select and weight comparable historical datasets for a target exam
   */
  async selectComparableDatasets(params: {
    examType: string;
    totalMarks: number;
    limit?: number;
  }): Promise<SelectedHistoricalDataset[]> {
    const { examType, totalMarks } = params;
    const limit = params.limit || 5;

    // Query valid historical exams with score ranges
    const historicalExams = await this.prisma.historicalExam.findMany({
      where: {
        dataQualityStatus: 'VALID',
        scoreRanges: { some: {} },
      },
      include: {
        scoreRanges: {
          orderBy: { minScore: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (historicalExams.length === 0) {
      this.logger.warn(`No VALID historical datasets found for prediction`);
      return [];
    }

    // Score relevance for each exam
    const scoredList: {
      exam: (typeof historicalExams)[0];
      relevance: number;
    }[] = [];

    for (const hExam of historicalExams) {
      let score = 10; // baseline

      // Same Exam Type (+40)
      if (hExam.examType.toUpperCase() === examType.toUpperCase()) {
        score += 40;
      }

      // Same Total Marks (+30)
      if (hExam.totalMarks === totalMarks) {
        score += 30;
      } else if (Math.abs(hExam.totalMarks - totalMarks) / totalMarks <= 0.2) {
        score += 15;
      }

      // Large population (+15)
      if (hExam.totalCandidates >= 5000) {
        score += 15;
      } else if (hExam.totalCandidates >= 1000) {
        score += 8;
      }

      // High Quality Score (+10)
      if (hExam.qualityScore && hExam.qualityScore >= 90) {
        score += 10;
      }

      scoredList.push({ exam: hExam, relevance: score });
    }

    // Sort by relevance descending and take top N
    scoredList.sort((a, b) => b.relevance - a.relevance);
    const topSelected = scoredList.slice(0, limit);

    const sumRelevance = topSelected.reduce(
      (sum, item) => sum + item.relevance,
      0,
    );

    return topSelected.map((item) => {
      const hExam = item.exam;
      const weight =
        sumRelevance > 0
          ? Math.round((item.relevance / sumRelevance) * 10000) / 10000
          : 1 / topSelected.length;

      return {
        historicalExamId: hExam.id,
        examName: hExam.examName,
        examType: hExam.examType,
        totalMarks: hExam.totalMarks,
        totalCandidates: hExam.totalCandidates,
        weight,
        scoreRanges: hExam.scoreRanges.map((r) => ({
          minScore: r.minScore,
          maxScore: r.maxScore,
          representativeScore: r.representativeScore,
          minRank: r.minRank,
          maxRank: r.maxRank,
          candidateCount: r.candidateCount,
        })),
      };
    });
  }
}
