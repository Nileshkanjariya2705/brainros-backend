import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidateRankInput } from '../interfaces/rank-engine.interface';

@Injectable()
export class RankingCandidateEligibilityService {
  private readonly logger = new Logger(RankingCandidateEligibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch and normalize all eligible candidate attempts for ranking
   */
  async getEligibleCandidates(
    examId: string,
    examVersionId?: string,
  ): Promise<CandidateRankInput[]> {
    const whereClause: any = {
      examId,
      result: { isNot: null },
    };

    if (examVersionId) {
      whereClause.examVersionId = examVersionId;
    }

    const attempts = await this.prisma.attempt.findMany({
      where: whereClause,
      include: {
        exam: true,
        result: true,
        student: {
          include: {
            user: { select: { email: true, phone: true } },
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });

    const candidates: CandidateRankInput[] = [];

    for (const att of attempts) {
      if (!att.result) continue;

      const res = att.result;
      const student = att.student;
      const defaultNeg = att.exam?.defaultNegativeMarks ?? 1;
      const negativeMarksLost = (res.wrongAnswers || 0) * defaultNeg;

      candidates.push({
        attemptId: att.id,
        studentId: student.id,
        studentName: student.name,
        studentCode: student.studentId,
        score: res.totalScore,
        maxScore: res.maxScore,
        percentage: res.percentage,
        accuracy: res.accuracy,
        correctCount: res.correctAnswers,
        wrongCount: res.wrongAnswers,
        unattemptedCount: res.unattempted,
        negativeMarksLost: Math.round(negativeMarksLost * 100) / 100,
        timeUsedSeconds: res.timeUsedSeconds || 0,
        state: student.state ? student.state.trim() : null,
        district: student.district ? student.district.trim() : null,
        schoolCollege: student.schoolCollege
          ? student.schoolCollege.trim()
          : null,
        category: 'GENERAL', // extensible default
      });
    }

    this.logger.log(
      `Found ${candidates.length} eligible candidates for exam '${examId}' ranking`,
    );
    return candidates;
  }
}
