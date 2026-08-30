import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DirectComparisonResponse,
  MockDataPoint,
} from '../interfaces/performance-trend.interface';

@Injectable()
export class MockComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compare two mock attempts side-by-side
   */
  async compareMocks(
    attemptAId: string,
    attemptBId: string,
    studentId: string,
  ): Promise<DirectComparisonResponse> {
    const attempts = await this.prisma.attempt.findMany({
      where: {
        id: { in: [attemptAId, attemptBId] },
      },
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
    });

    if (attempts.length !== 2) {
      throw new NotFoundException(
        'Both attempt records must exist for comparison',
      );
    }

    const attA = attempts.find((a) => a.id === attemptAId)!;
    const attB = attempts.find((a) => a.id === attemptBId)!;

    const student = await this.prisma.student?.findFirst?.({
      where: { OR: [{ id: studentId }, { userId: studentId }] },
    });
    const resolvedStudentId = student ? student.id : studentId;

    const matchesA =
      attA.studentId === studentId || attA.studentId === resolvedStudentId;
    const matchesB =
      attB.studentId === studentId || attB.studentId === resolvedStudentId;

    if (!matchesA || !matchesB) {
      throw new ForbiddenException('You can only compare your own attempts');
    }

    const mockA = this.mapToMockDataPoint(attA, 1, 'Mock A');
    const mockB = this.mapToMockDataPoint(attB, 2, 'Mock B');

    const scoreDelta = Math.round((mockB.score - mockA.score) * 100) / 100;
    const accuracyDelta =
      Math.round((mockB.accuracy - mockA.accuracy) * 100) / 100;
    const percentageDelta =
      Math.round((mockB.percentage - mockA.percentage) * 100) / 100;

    const rankDelta =
      mockB.rank !== null && mockA.rank !== null
        ? mockB.rank - mockA.rank
        : null;
    const rankImprovement = rankDelta !== null ? -rankDelta : null;

    const percentileDelta =
      mockB.percentile !== null && mockA.percentile !== null
        ? Math.round((mockB.percentile - mockA.percentile) * 100) / 100
        : null;

    const timeDeltaSeconds =
      mockB.timeUsedSeconds !== null && mockA.timeUsedSeconds !== null
        ? mockB.timeUsedSeconds - mockA.timeUsedSeconds
        : null;

    // Subject breakdown deltas
    const subjectDeltas: DirectComparisonResponse['subjectDeltas'] = [];
    const subMapA = new Map(
      (attA.result?.subjectResults || []).map((s) => [s.subjectId, s]),
    );

    for (const subB of attB.result?.subjectResults || []) {
      const subA = subMapA.get(subB.subjectId);
      const accA = subA?.accuracy ?? 0;
      const scoreA = subA?.score ?? 0;

      subjectDeltas.push({
        subjectId: subB.subjectId,
        subjectName: subB.subject?.name || 'Subject',
        accuracyDelta: Math.round((subB.accuracy - accA) * 10) / 10,
        scoreDelta: Math.round((subB.score - scoreA) * 10) / 10,
      });
    }

    return {
      mockA,
      mockB,
      scoreDelta,
      accuracyDelta,
      percentageDelta,
      rankDelta,
      rankImprovement,
      percentileDelta,
      timeDeltaSeconds,
      subjectDeltas,
    };
  }

  private mapToMockDataPoint(
    att: any,
    mockNumber: number,
    label: string,
  ): MockDataPoint {
    const res = att.result || {};
    const rankRecord = att.candidateRanks?.[0];
    const timeRecord = att.timeAnalyses?.[0];

    return {
      attemptId: att.id,
      examId: att.examId,
      examTitle: att.exam.title,
      examType: att.exam.examTarget?.name || 'GENERAL',
      mockNumber,
      label,
      date: att.serverEndTime
        ? new Date(att.serverEndTime).toISOString().split('T')[0]
        : new Date(att.createdAt).toISOString().split('T')[0],
      score: res.totalScore ?? 0,
      maxScore: res.maxScore ?? att.exam.totalMarks ?? 720,
      percentage: res.percentage ?? 0,
      accuracy: res.accuracy ?? 0,
      rank: rankRecord ? rankRecord.rank : null,
      totalCandidates: rankRecord ? rankRecord.totalCandidates : null,
      percentile: rankRecord ? rankRecord.percentile : null,
      timeUsedSeconds: timeRecord
        ? timeRecord.totalTimeUsedSeconds
        : (res.timeUsedSeconds ?? null),
      timeUtilizationPercentage: timeRecord
        ? timeRecord.timeUtilizationPercentage
        : null,
    };
  }
}
