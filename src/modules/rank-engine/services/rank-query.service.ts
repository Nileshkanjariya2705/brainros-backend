import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MyRanksResponse,
  ScopedRankSummary,
  AdminLeaderboardResponse,
  LeaderboardEntry,
} from '../interfaces/rank-engine.interface';
import { QueryLeaderboardDto } from '../dto/rank-engine.dto';

@Injectable()
export class RankQueryService {
  private readonly logger = new Logger(RankQueryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fast indexed read of a student's calculated ranks across all scopes
   */
  async getMyRanks(
    attemptId: string,
    studentId: string,
  ): Promise<MyRanksResponse> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        student: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt '${attemptId}' not found`);
    }

    if (
      attempt.studentId !== studentId &&
      attempt.student?.userId !== studentId
    ) {
      throw new ForbiddenException('You do not own this attempt');
    }

    // Find latest completed RankSnapshot for this exam
    const snapshot = await this.prisma.rankSnapshot.findFirst({
      where: { examId: attempt.examId, status: 'COMPLETED' },
      orderBy: { snapshotVersion: 'desc' },
    });

    if (!snapshot) {
      return {
        attemptId,
        examId: attempt.examId,
        examTitle: attempt.exam.title,
        status: 'RANK_PENDING',
        snapshotVersion: 0,
        overall: {
          type: 'OVERALL',
          rank: 0,
          totalCandidates: 0,
          percentile: 0,
          score: 0,
          accuracy: 0,
        },
      };
    }

    // Query candidate ranks for this attempt in this snapshot
    const ranks = await this.prisma.candidateRank.findMany({
      where: {
        rankSnapshotId: snapshot.id,
        attemptId,
      },
    });

    const rankMap = new Map<string, (typeof ranks)[0]>();
    for (const r of ranks) {
      rankMap.set(r.rankType, r);
    }

    const overallRow = rankMap.get('OVERALL');

    const toSummary = (
      row?: (typeof ranks)[0],
    ): ScopedRankSummary | undefined => {
      if (!row) return undefined;
      return {
        type: row.rankType,
        scopeName: row.scopeName || undefined,
        rank: row.rank,
        totalCandidates: row.totalCandidates,
        percentile: row.percentile,
        score: row.score,
        accuracy: row.accuracy,
      };
    };

    const overallSummary: ScopedRankSummary = toSummary(overallRow) || {
      type: 'OVERALL',
      rank: 0,
      totalCandidates: snapshot.totalCandidates,
      percentile: 0,
      score: 0,
      accuracy: 0,
    };

    const predicted = overallRow?.predictedRankMin
      ? {
          predictedRankMin: overallRow.predictedRankMin,
          predictedRankMax:
            overallRow.predictedRankMax || overallRow.predictedRankMin,
          confidence: (overallRow.predictionConfidence as any) || 'MEDIUM',
          modelVersion: overallRow.predictionModelVersion || 'v1.0.0',
          disclaimer:
            'Predicted rank is a statistical projection based on performance distribution and historical benchmarks. It is not an official rank.',
        }
      : null;

    return {
      attemptId,
      examId: attempt.examId,
      examTitle: attempt.exam.title,
      status: 'RANK_READY',
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: snapshot.completedAt
        ? snapshot.completedAt.toISOString()
        : undefined,
      overall: overallSummary,
      state: toSummary(rankMap.get('STATE')),
      district: toSummary(rankMap.get('DISTRICT')),
      school: toSummary(rankMap.get('SCHOOL')),
      college: toSummary(rankMap.get('COLLEGE')),
      category: toSummary(rankMap.get('CATEGORY')),
      predictedRank: predicted,
    };
  }

  /**
   * Fast indexed read of Admin Leaderboard with pagination and scope filters
   */
  async getAdminLeaderboard(
    examId: string,
    query: QueryLeaderboardDto,
  ): Promise<AdminLeaderboardResponse> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
    });
    if (!exam) {
      throw new NotFoundException(`Exam '${examId}' not found`);
    }

    const snapshot = await this.prisma.rankSnapshot.findFirst({
      where: { examId, status: 'COMPLETED' },
      orderBy: { snapshotVersion: 'desc' },
    });

    if (!snapshot) {
      return {
        examId,
        examTitle: exam.title,
        rankType: (query.rankType as any) || 'OVERALL',
        snapshotVersion: 0,
        totalCandidates: 0,
        page: query.page || 1,
        limit: query.limit || 25,
        totalPages: 0,
        items: [],
      };
    }

    const rankType = (query.rankType as any) || 'OVERALL';
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 25));
    const skip = (page - 1) * limit;

    const where: any = {
      rankSnapshotId: snapshot.id,
      rankType,
    };

    if (query.scopeId) where.scopeId = query.scopeId;
    if (query.categoryId) where.categoryId = query.categoryId;

    if (query.search) {
      where.student = {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { studentId: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const [totalCount, rows] = await Promise.all([
      this.prisma.candidateRank.count({ where }),
      this.prisma.candidateRank.findMany({
        where,
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
        include: {
          student: {
            select: {
              id: true,
              name: true,
              studentId: true,
              state: true,
              district: true,
              schoolCollege: true,
            },
          },
        },
      }),
    ]);

    const items: LeaderboardEntry[] = rows.map((r) => ({
      rank: r.rank,
      studentId: r.student.id,
      studentName: r.student.name,
      studentCode: r.student.studentId,
      score: r.score,
      percentage: Math.round((r.score / (exam.totalMarks || 1)) * 10000) / 100,
      accuracy: r.accuracy,
      timeUsedSeconds: r.timeUsedSeconds || 0,
      percentile: r.percentile,
      state: r.student.state,
      district: r.student.district,
      schoolCollege: r.student.schoolCollege,
    }));

    return {
      examId,
      examTitle: exam.title,
      rankType,
      scopeName: query.scopeId,
      snapshotVersion: snapshot.snapshotVersion,
      totalCandidates: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      items,
    };
  }

  /**
   * Get Rank Prediction for an attempt
   */
  async getRankPrediction(attemptId: string, studentId: string) {
    const ranks = await this.getMyRanks(attemptId, studentId);
    return {
      attemptId,
      examId: ranks.examId,
      predictedRank: ranks.predictedRank,
    };
  }

  /**
   * Get snapshot status for an exam
   */
  async getSnapshotStatus(examId: string, snapshotVersion?: number) {
    const where: any = { examId };
    if (snapshotVersion) where.snapshotVersion = snapshotVersion;

    const snapshot = await this.prisma.rankSnapshot.findFirst({
      where,
      orderBy: { snapshotVersion: 'desc' },
    });

    if (!snapshot) {
      return { examId, status: 'NO_SNAPSHOT_FOUND' };
    }

    return {
      examId: snapshot.examId,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.snapshotVersion,
      status: snapshot.status,
      totalCandidates: snapshot.totalCandidates,
      highestScore: snapshot.highestScore,
      lowestScore: snapshot.lowestScore,
      averageScore: snapshot.averageScore,
      medianScore: snapshot.medianScore,
      integrityChecksPassed: snapshot.integrityChecksPassed,
      generatedAt: snapshot.generatedAt,
      completedAt: snapshot.completedAt,
    };
  }
}
