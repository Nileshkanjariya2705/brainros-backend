import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StudentComparisonQueryDto } from '../dto/student-comparison.dto';
import {
  DetailedComparisonResponse,
  ComparisonAttemptItem,
  ComparisonSummary,
  SubjectComparisonRow,
} from '../interfaces/student-comparison.interface';

@Injectable()
export class StudentComparisonService {
  private readonly logger = new Logger(StudentComparisonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Compare multiple completed/evaluated mock attempts for the student
   */
  async getStudentComparison(
    userId: string,
    query: StudentComparisonQueryDto,
  ): Promise<DetailedComparisonResponse> {
    const filterHash = `${query.examType || 'ALL'}_${query.from || ''}_${query.to || ''}_${query.limit || 10}_${query.attemptIds || ''}`;
    const cacheKey = `student:${userId}:comparison:${filterHash}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore cache failure
    }

    // 1. Resolve student record
    const student = await this.prisma.student.findFirst({
      where: { OR: [{ userId }, { id: userId }] },
    });

    if (!student) {
      throw new NotFoundException(`Student profile not found for user '${userId}'`);
    }

    const studentId = student.id;

    // 2. Build where clause
    const where: any = {
      studentId,
      result: { isNot: null },
      status: { name: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
    };

    if (query.attemptIds) {
      const ids = query.attemptIds.split(',').map((id) => id.trim()).filter(Boolean);
      if (ids.length > 0) {
        where.id = { in: ids };
      }
    }

    if (query.examType) {
      where.exam = {
        examTarget: {
          name: { equals: query.examType, mode: 'insensitive' },
        },
      };
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    // 3. Load attempts in chronological order (oldest to newest)
    const rawAttempts: any[] = await this.prisma.attempt.findMany({
      where,
      include: {
        exam: { include: { examTarget: true } },
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
      orderBy: { createdAt: 'asc' },
      take: query.limit || 10,
    });

    // 4. Handle empty state
    if (!rawAttempts || rawAttempts.length === 0) {
      const emptyResponse: DetailedComparisonResponse = {
        summary: {
          totalAttempts: 0,
          first: null,
          latest: null,
          best: null,
          scoreDelta: 0,
          percentageDelta: 0,
          accuracyDelta: 0,
          rankDelta: null,
          rankImprovement: null,
          percentileDelta: null,
          timeUsedDeltaSeconds: null,
          trendDirections: {
            scoreTrend: 'INSUFFICIENT_DATA',
            accuracyTrend: 'INSUFFICIENT_DATA',
            rankTrend: 'INSUFFICIENT_DATA',
            percentileTrend: 'INSUFFICIENT_DATA',
          },
        },
        attempts: [],
        scoreTrend: [],
        accuracyTrend: [],
        rankTrend: [],
        percentileTrend: [],
        timeTrend: [],
        subjectComparison: [],
        subjectTrends: [],
        insights: [
          'No completed mock tests found. Complete mock exams to unlock full comparative analytics.',
        ],
      };
      return emptyResponse;
    }

    // 5. Map attempts
    const attempts: ComparisonAttemptItem[] = [];
    const scoreTrend: Array<{ attemptId: string; label: string; date: string; score: number; maxScore: number; percentage: number }> = [];
    const accuracyTrend: Array<{ attemptId: string; label: string; date: string; accuracy: number }> = [];
    const rankTrend: Array<{ attemptId: string; label: string; date: string; rank: number | null; totalCandidates: number | null; percentile: number | null }> = [];
    const percentileTrend: Array<{ attemptId: string; label: string; date: string; percentile: number | null }> = [];
    const timeTrend: Array<{ attemptId: string; label: string; date: string; timeUsedMinutes: number | null; averageTimePerQuestionSeconds: number | null }> = [];

    const subjectMap = new Map<string, { subjectId: string; subjectName: string; accuracies: Record<string, number>; scores: Record<string, number>; series: Array<{ mockLabel: string; accuracy: number; score: number }> }>();

    rawAttempts.forEach((att, idx) => {
      const mockNumber = idx + 1;
      const label = `Mock ${String(mockNumber).padStart(2, '0')}`;
      const date = att.serverEndTime
        ? new Date(att.serverEndTime).toISOString().split('T')[0]
        : new Date(att.createdAt).toISOString().split('T')[0];

      const res = att.result || ({} as any);
      const score = res.totalScore ?? 0;
      const maxScore = res.maxScore ?? att.exam.totalMarks ?? 720;
      const percentage = res.percentage ?? 0;
      const accuracy = res.accuracy ?? 0;

      const rankRecord = att.candidateRanks?.[0];
      const rank = rankRecord ? rankRecord.rank : null;
      const totalCandidates = rankRecord ? rankRecord.totalCandidates : null;
      const percentile = rankRecord ? rankRecord.percentile : null;

      const timeRecord = att.timeAnalyses?.[0];
      const timeUsedSeconds = timeRecord ? timeRecord.totalTimeUsedSeconds : res.timeUsedSeconds ?? null;
      const avgTime = timeRecord ? timeRecord.averageTimePerQuestionSeconds : res.averageTimePerQuestion ?? null;

      attempts.push({
        attemptId: att.id,
        examId: att.examId,
        examName: att.exam.title || label,
        examType: att.exam.examTarget?.name || 'NEET',
        date,
        score,
        maximumScore: maxScore,
        percentage,
        accuracy,
        rank,
        totalCandidates,
        percentile,
        timeUsedSeconds,
        averageTimePerQuestionSeconds: avgTime,
        correctCount: res.correctCount ?? 0,
        wrongCount: res.incorrectCount ?? 0,
        unattemptedCount: res.unattemptedCount ?? 0,
        status: 'EVALUATED',
      });

      scoreTrend.push({ attemptId: att.id, label, date, score, maxScore, percentage });
      accuracyTrend.push({ attemptId: att.id, label, date, accuracy });
      rankTrend.push({ attemptId: att.id, label, date, rank, totalCandidates, percentile });
      percentileTrend.push({ attemptId: att.id, label, date, percentile });
      timeTrend.push({
        attemptId: att.id,
        label,
        date,
        timeUsedMinutes: timeUsedSeconds ? Math.round(timeUsedSeconds / 60) : null,
        averageTimePerQuestionSeconds: avgTime,
      });

      // Subject breakdown
      (res.subjectResults || []).forEach((sr: any) => {
        const subName = sr.subject.name;
        if (!subjectMap.has(subName)) {
          subjectMap.set(subName, {
            subjectId: sr.subjectId,
            subjectName: subName,
            accuracies: {},
            scores: {},
            series: [],
          });
        }
        const entry = subjectMap.get(subName)!;
        entry.accuracies[label] = sr.accuracy;
        entry.scores[label] = sr.score;
        entry.series.push({ mockLabel: label, accuracy: sr.accuracy, score: sr.score });
      });
    });

    // 6. First, Latest, Best calculations
    const firstAtt = attempts[0];
    const latestAtt = attempts[attempts.length - 1];

    let bestAtt = attempts[0];
    attempts.forEach((att) => {
      if (att.percentage > bestAtt.percentage) {
        bestAtt = att;
      }
    });

    const scoreDelta = Math.round((latestAtt.score - firstAtt.score) * 10) / 10;
    const percentageDelta = Math.round((latestAtt.percentage - firstAtt.percentage) * 10) / 10;
    const accuracyDelta = Math.round((latestAtt.accuracy - firstAtt.accuracy) * 10) / 10;

    let rankDelta: number | null = null;
    let rankImprovement: number | null = null;
    if (firstAtt.rank !== null && latestAtt.rank !== null) {
      rankDelta = latestAtt.rank - firstAtt.rank;
      // Lower rank is better -> 5240 - 2841 = +2399 positions improved
      rankImprovement = firstAtt.rank - latestAtt.rank;
    }

    const percentileDelta =
      firstAtt.percentile !== null && latestAtt.percentile !== null
        ? Math.round((latestAtt.percentile - firstAtt.percentile) * 10) / 10
        : null;

    const timeUsedDeltaSeconds =
      firstAtt.timeUsedSeconds !== null && latestAtt.timeUsedSeconds !== null
        ? latestAtt.timeUsedSeconds - firstAtt.timeUsedSeconds
        : null;

    const calcDir = (diff: number, lowerIsBetter = false) => {
      if (diff === 0) return 'STABLE';
      if (lowerIsBetter) return diff < 0 ? 'IMPROVING' : 'DECLINING';
      return diff > 0 ? 'IMPROVING' : 'DECLINING';
    };

    const summary: ComparisonSummary = {
      totalAttempts: attempts.length,
      first: {
        attemptId: firstAtt.attemptId,
        label: `Mock 01`,
        date: firstAtt.date,
        score: firstAtt.score,
        maximumScore: firstAtt.maximumScore,
        percentage: firstAtt.percentage,
        accuracy: firstAtt.accuracy,
        rank: firstAtt.rank,
        percentile: firstAtt.percentile,
        timeUsedSeconds: firstAtt.timeUsedSeconds,
      },
      latest: {
        attemptId: latestAtt.attemptId,
        label: `Mock ${String(attempts.length).padStart(2, '0')}`,
        date: latestAtt.date,
        score: latestAtt.score,
        maximumScore: latestAtt.maximumScore,
        percentage: latestAtt.percentage,
        accuracy: latestAtt.accuracy,
        rank: latestAtt.rank,
        percentile: latestAtt.percentile,
        timeUsedSeconds: latestAtt.timeUsedSeconds,
      },
      best: {
        attemptId: bestAtt.attemptId,
        label: bestAtt.examName,
        score: bestAtt.score,
        percentage: bestAtt.percentage,
        accuracy: bestAtt.accuracy,
        rank: bestAtt.rank,
        percentile: bestAtt.percentile,
      },
      scoreDelta,
      percentageDelta,
      accuracyDelta,
      rankDelta,
      rankImprovement,
      percentileDelta,
      timeUsedDeltaSeconds,
      trendDirections: {
        scoreTrend: calcDir(scoreDelta),
        accuracyTrend: calcDir(accuracyDelta),
        rankTrend: rankImprovement !== null ? (rankImprovement > 0 ? 'IMPROVING' : rankImprovement < 0 ? 'DECLINING' : 'STABLE') : 'INSUFFICIENT_DATA',
        percentileTrend: percentileDelta !== null ? calcDir(percentileDelta) : 'INSUFFICIENT_DATA',
      },
    };

    // 7. Format Subject Comparison Table & Trends
    const subjectComparison: SubjectComparisonRow[] = [];
    const subjectTrends: Array<{ subjectId: string; subjectName: string; data: Array<{ mockLabel: string; accuracy: number; score: number }> }> = [];

    subjectMap.forEach((val) => {
      const firstAcc = val.accuracies['Mock 01'] ?? 0;
      const latestMockLabel = `Mock ${String(attempts.length).padStart(2, '0')}`;
      const latestAcc = val.accuracies[latestMockLabel] ?? firstAcc;

      subjectComparison.push({
        subjectId: val.subjectId,
        subjectName: val.subjectName,
        mockAccuracies: val.accuracies,
        mockScores: val.scores,
        trendDelta: Math.round((latestAcc - firstAcc) * 10) / 10,
      });

      subjectTrends.push({
        subjectId: val.subjectId,
        subjectName: val.subjectName,
        data: val.series,
      });
    });

    // 8. Generate Clear, Actionable Insights
    const insights: string[] = [];

    if (scoreDelta > 0) {
      insights.push(`✓ Your score improved by ${scoreDelta} marks from your first mock to latest.`);
    } else if (scoreDelta < 0) {
      insights.push(`⚠ Your overall score dropped by ${Math.abs(scoreDelta)} marks. Review high-error chapters.`);
    } else {
      insights.push(`• Score performance has remained stable across tested mocks.`);
    }

    if (accuracyDelta > 0) {
      insights.push(`✓ Overall accuracy improved by +${accuracyDelta}% across attempted sessions.`);
    }

    if (rankImprovement && rankImprovement > 0) {
      insights.push(`✓ Your rank advanced by ${rankImprovement.toLocaleString('en-IN')} positions.`);
    }

    if (subjectComparison.length > 0) {
      const sortedByDelta = [...subjectComparison].sort((a, b) => (b.trendDelta || 0) - (a.trendDelta || 0));
      const mostImproved = sortedByDelta[0];
      if (mostImproved && (mostImproved.trendDelta || 0) > 0) {
        insights.push(`✓ ${mostImproved.subjectName} shows the highest accuracy improvement (+${mostImproved.trendDelta}%).`);
      }

      const weakest = [...subjectComparison].sort((a, b) => {
        const lastA = Object.values(a.mockAccuracies).pop() || 0;
        const lastB = Object.values(b.mockAccuracies).pop() || 0;
        return lastA - lastB;
      })[0];

      if (weakest) {
        const lastAcc = Object.values(weakest.mockAccuracies).pop() || 0;
        if (lastAcc < 70) {
          insights.push(`⚠ ${weakest.subjectName} remains your priority focus area (${lastAcc}% accuracy).`);
        }
      }
    }

    if (timeUsedDeltaSeconds && timeUsedDeltaSeconds < 0 && scoreDelta >= 0) {
      insights.push(`⚡ Faster test completion: Time spent decreased by ${Math.abs(Math.round(timeUsedDeltaSeconds / 60))} minutes while maintaining performance.`);
    }

    const response: DetailedComparisonResponse = {
      summary,
      attempts,
      scoreTrend,
      accuracyTrend,
      rankTrend,
      percentileTrend,
      timeTrend,
      subjectComparison,
      subjectTrends,
      insights,
    };

    // Cache in Redis for 120 seconds
    try {
      await this.redis.set(cacheKey, JSON.stringify(response), 120);
    } catch {
      // Ignore cache write error
    }

    return response;
  }
}
