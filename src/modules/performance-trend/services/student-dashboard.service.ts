import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  StudentDashboardResponse,
  NextExamWidget,
  ActiveAttemptWidget,
  PerformanceSummaryWidget,
  RankSummaryWidget,
  PredictedRankWidget,
  SubjectSummaryItem,
  WeakAreaItem,
  DashboardRecommendationItem,
  TimeManagementWidget,
  AttemptStrategyWidget,
  RecentResultItem,
} from '../interfaces/student-dashboard.interface';

@Injectable()
export class StudentDashboardService {
  private readonly logger = new Logger(StudentDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Aggregate complete Student Dashboard data in an optimized single entry point
   */
  async getStudentDashboard(userId: string): Promise<StudentDashboardResponse> {
    const cacheKey = `student:${userId}:dashboard`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore cache failure, proceed with DB query
    }

    // 1. Fetch Student Profile with Target, Class, and Language
    const student: any = await this.prisma.student.findFirst({
      where: { OR: [{ userId }, { id: userId }] },
      include: {
        user: { select: { id: true, email: true, mobileNumber: true } },
        examTarget: { select: { id: true, name: true } },
        studentClass: { select: { id: true, name: true } },
        preferredLanguage: { select: { id: true, name: true } },
      },
    });

    if (!student) {
      throw new NotFoundException(`Student profile not found for user '${userId}'`);
    }

    const studentId = student.id;
    const now = new Date();

    // 2. Fetch Active/Ongoing Attempt (if student has an in-progress exam)
    const activeAttemptRecord = await this.prisma.attempt.findFirst({
      where: {
        studentId,
        status: { name: 'IN_PROGRESS' },
      },
      include: {
        exam: { select: { id: true, title: true, durationMinutes: true, totalQuestions: true } },
        answers: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let activeAttempt: ActiveAttemptWidget | null = null;
    if (activeAttemptRecord) {
      const startedAt = activeAttemptRecord.startedAt || activeAttemptRecord.createdAt;
      const durationMs = (activeAttemptRecord.exam.durationMinutes || 180) * 60 * 1000;
      const expectedEnd = activeAttemptRecord.serverEndTime
        ? new Date(activeAttemptRecord.serverEndTime).getTime()
        : new Date(startedAt).getTime() + durationMs;

      const remainingSec = Math.max(0, Math.ceil((expectedEnd - now.getTime()) / 1000));

      activeAttempt = {
        attemptId: activeAttemptRecord.id,
        examId: activeAttemptRecord.exam.id,
        examTitle: activeAttemptRecord.exam.title,
        startedAt: startedAt.toISOString(),
        serverEndTime: activeAttemptRecord.serverEndTime
          ? new Date(activeAttemptRecord.serverEndTime).toISOString()
          : new Date(expectedEnd).toISOString(),
        timeRemainingSeconds: remainingSec,
        currentQuestionNumber: (activeAttemptRecord.answers?.length || 0) + 1,
        totalQuestions: activeAttemptRecord.exam.totalQuestions || 180,
        answeredCount: activeAttemptRecord.answers?.length || 0,
      };
    }

    // 3. Fetch Upcoming / Live Exams for Student's Target
    const upcomingExamRecords = await this.prisma.exam.findMany({
      where: {
        status: { name: { in: ['SCHEDULED', 'ACTIVE'] } },
        ...(student.examTargetId
          ? {
              OR: [
                { examTargetId: student.examTargetId },
                { examTarget: { name: 'General' } },
              ],
            }
          : {}),
        NOT: {
          attempts: {
            some: {
              studentId,
              status: { name: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
            },
          },
        },
      },
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        schedules: {
          where: { status: { in: ['SCHEDULED', 'ACTIVE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ startTime: 'asc' }, { createdAt: 'desc' }],
      take: 10,
    });

    const upcomingExams: NextExamWidget[] = upcomingExamRecords.map((rec) => {
      const schedule = rec.schedules?.[0];
      const startTime = schedule?.startTime || rec.startTime || rec.examDate;
      const endTime = schedule?.endTime || rec.endTime;

      let canStart = false;
      let waitSeconds = 0;
      let accessStatus = 'AVAILABLE';
      let message = 'Exam is ready to attempt.';

      if (startTime && now.getTime() < new Date(startTime).getTime()) {
        accessStatus = 'NOT_YET_STARTED';
        waitSeconds = Math.ceil((new Date(startTime).getTime() - now.getTime()) / 1000);
        message = `Starts in ${Math.floor(waitSeconds / 3600)}h ${Math.floor((waitSeconds % 3600) / 60)}m`;
      } else if (endTime && now.getTime() > new Date(endTime).getTime()) {
        accessStatus = 'ENDED';
        message = 'Exam window closed.';
      } else {
        canStart = true;
        message = 'Exam is live now!';
      }

      return {
        examId: rec.id,
        title: rec.title,
        examTarget: rec.examTarget?.name || student.examTarget?.name || 'General',
        durationMinutes: rec.durationMinutes,
        totalQuestions: rec.totalQuestions,
        totalMarks: rec.totalMarks,
        startTime: startTime ? new Date(startTime).toISOString() : null,
        endTime: endTime ? new Date(endTime).toISOString() : null,
        status: rec.status?.name || 'SCHEDULED',
        canStart,
        waitSeconds,
        accessStatus,
        message,
      };
    });

    const nextExam = upcomingExams[0] || null;

    // 4. Fetch Evaluated Mocks (Latest 10 for trends & performance)
    const evaluatedAttempts: any[] = await this.prisma.attempt.findMany({
      where: {
        studentId,
        result: { isNot: null },
        status: { name: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
      },
      include: {
        exam: { select: { id: true, title: true, totalMarks: true, examTarget: true } },
        result: {
          include: {
            subjectResults: {
              include: { subject: true },
            },
            chapterResults: {
              include: { chapter: { include: { subject: true } } },
            },
          },
        },
        candidateRanks: {
          orderBy: { createdAt: 'desc' },
        },
        timeAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        strategyAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' }, // Oldest to newest
    });

    const totalEvaluatedCount = evaluatedAttempts.length;
    const latestAttempt = totalEvaluatedCount > 0 ? evaluatedAttempts[totalEvaluatedCount - 1] : null;
    const previousAttempt = totalEvaluatedCount > 1 ? evaluatedAttempts[totalEvaluatedCount - 2] : null;

    // 5. Performance Summary
    let latestPerformance: PerformanceSummaryWidget | null = null;
    if (latestAttempt && latestAttempt.result) {
      const res = latestAttempt.result;
      latestPerformance = {
        latestScore: res.totalScore,
        maxScore: res.maxScore || latestAttempt.exam.totalMarks || 720,
        percentage: Math.round(Number(res.percentage || 0) * 100) / 100,
        accuracy: Math.round(Number(res.accuracy || 0) * 100) / 100,
        totalAttempts: totalEvaluatedCount,
        timeSpentSeconds: res.timeUsedSeconds || 0,
        correctCount: res.correctCount,
        incorrectCount: res.incorrectCount,
        unattemptedCount: res.unattemptedCount,
      };
    }

    // 6. Rank & Predicted Rank
    let rank: RankSummaryWidget | null = null;
    let predictedRank: PredictedRankWidget | null = null;

    if (latestAttempt) {
      const overallRank = latestAttempt.candidateRanks?.find((r) => r.rankType === 'OVERALL') || latestAttempt.candidateRanks?.[0];
      const stateRankRecord = latestAttempt.candidateRanks?.find((r) => r.rankType === 'STATE');
      const categoryRankRecord = latestAttempt.candidateRanks?.find((r) => r.rankType === 'CATEGORY');

      if (overallRank) {
        rank = {
          rank: overallRank.rank,
          totalCandidates: overallRank.totalCandidates,
          percentile: overallRank.percentile,
          stateRank: stateRankRecord ? stateRankRecord.rank : null,
          categoryRank: categoryRankRecord ? categoryRankRecord.rank : null,
        };

        if (overallRank.predictedRankMin || overallRank.predictedRankMax) {
          predictedRank = {
            predictedRankMin: overallRank.predictedRankMin,
            predictedRankMax: overallRank.predictedRankMax,
            confidence: (overallRank.predictionConfidence as any) || 'MEDIUM',
            modelVersion: overallRank.predictionModelVersion || 'v2.4',
            isEstimated: true,
          };
        }
      }
    }

    // 7. Subject Performance & Subject Trends
    const subjects: SubjectSummaryItem[] = [];
    if (latestAttempt && latestAttempt.result?.subjectResults) {
      const prevSubjectMap = new Map<string, number>();
      if (previousAttempt && previousAttempt.result?.subjectResults) {
        previousAttempt.result.subjectResults.forEach((sr) => {
          prevSubjectMap.set(sr.subject.name.toLowerCase(), sr.accuracy);
        });
      }

      latestAttempt.result.subjectResults.forEach((sr) => {
        const accuracy = sr.accuracy;
        const status: 'EXCELLENT' | 'GOOD' | 'WEAK' =
          accuracy >= 80 ? 'EXCELLENT' : accuracy >= 65 ? 'GOOD' : 'WEAK';

        const prevAcc = prevSubjectMap.get(sr.subject.name.toLowerCase());
        const trendDelta = prevAcc !== undefined ? Math.round((accuracy - prevAcc) * 10) / 10 : null;

        subjects.push({
          subjectId: sr.subjectId,
          subjectName: sr.subject.name,
          score: sr.score,
          maxScore: sr.maxScore,
          accuracy: Math.round(Number(accuracy || 0) * 100) / 100,
          status,
          trendDelta,
        });
      });
    }

    // 8. Weak Areas (Chapters/Topics with lowest accuracy < 70%)
    const weakAreas: WeakAreaItem[] = [];
    if (latestAttempt && latestAttempt.result?.chapterResults) {
      const allChapters: Array<{ subject: string; name: string; accuracy: number; total: number }> =
        latestAttempt.result.chapterResults.map((cr: any) => ({
          subject: cr.chapter?.subject?.name || 'General',
          name: cr.chapter?.name || 'Chapter',
          accuracy: Math.round(Number(cr.accuracy || 0) * 100) / 100,
          total: cr.totalQuestions,
        }));

      allChapters
        .filter((c) => c.accuracy < 70)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 4)
        .forEach((c) => {
          weakAreas.push({
            subjectName: c.subject,
            chapterName: c.name,
            accuracy: Math.round(Number(c.accuracy || 0) * 100) / 100,
            totalQuestions: c.total,
            status: c.accuracy < 50 ? 'WEAK' : 'NEEDS_FOCUS',
          });
        });
    }

    // 9. Time Management Widget
    let timeManagement: TimeManagementWidget | null = null;
    if (latestAttempt && latestAttempt.timeAnalyses?.[0]) {
      const ta = latestAttempt.timeAnalyses[0];
      timeManagement = {
        averageTimePerQuestionSeconds: ta.averageTimePerQuestionSeconds,
        timeUtilizationPercentage: ta.timeUtilizationPercentage,
        totalTimeUsedSeconds: ta.totalTimeUsedSeconds,
        status:
          ta.averageTimePerQuestionSeconds <= 60
            ? 'OPTIMAL'
            : ta.averageTimePerQuestionSeconds <= 85
              ? 'NEEDS_IMPROVEMENT'
              : 'SLOW',
      };
    } else if (latestAttempt && latestAttempt.result) {
      const res = latestAttempt.result;
      const avg = res.totalQuestions > 0 ? Math.round((res.timeUsedSeconds || 0) / res.totalQuestions) : 60;
      timeManagement = {
        averageTimePerQuestionSeconds: avg,
        timeUtilizationPercentage: 90,
        totalTimeUsedSeconds: res.timeUsedSeconds || 0,
        status: avg <= 65 ? 'OPTIMAL' : 'NEEDS_IMPROVEMENT',
      };
    }

    // 10. Attempt Strategy Widget
    let attemptStrategy: AttemptStrategyWidget | null = null;
    if (latestAttempt && latestAttempt.strategyAnalyses?.[0]) {
      const sa = latestAttempt.strategyAnalyses[0];
      attemptStrategy = {
        riskLevel: (sa.riskProfile as any) || 'MODERATE',
        highRiskAttemptsCount: sa.highRiskAttemptsCount || 0,
        avoidableNegativeMarks: sa.avoidableNegativeMarks || 0,
        scoreGainOpportunity: sa.scoreGainOpportunity || 0,
      };
    } else if (latestAttempt && latestAttempt.result) {
      const res = latestAttempt.result;
      const avoidable = (res.incorrectCount || 0) * (latestAttempt.exam.totalMarks > 300 ? 1 : 0.5);
      attemptStrategy = {
        riskLevel: res.accuracy >= 80 ? 'LOW' : res.accuracy >= 65 ? 'MODERATE' : 'HIGH',
        highRiskAttemptsCount: Math.round((res.incorrectCount || 0) * 0.6),
        avoidableNegativeMarks: Math.round(avoidable),
        scoreGainOpportunity: Math.round(avoidable * 1.5),
      };
    }

    // 11. Trend Summary & Chart Points
    const recentScores: Array<{ mockLabel: string; score: number; accuracy: number; rank: number | null; percentile: number | null }> = [];
    evaluatedAttempts.forEach((att, idx) => {
      const res = att.result;
      const r = att.candidateRanks?.find((x) => x.rankType === 'OVERALL') || att.candidateRanks?.[0];
      recentScores.push({
        mockLabel: `Mock ${idx + 1}`,
        score: res?.totalScore || 0,
        accuracy: Math.round(Number(res?.accuracy || 0) * 100) / 100,
        rank: r ? r.rank : null,
        percentile: r ? r.percentile : null,
      });
    });

    const calculateDirection = (arr: number[], lowerIsBetter = false) => {
      if (arr.length < 2) return 'INSUFFICIENT_DATA';
      const first = arr[0];
      const last = arr[arr.length - 1];
      if (lowerIsBetter) {
        return last < first ? 'IMPROVING' : last > first ? 'DECLINING' : 'STABLE';
      }
      return last > first ? 'IMPROVING' : last < first ? 'DECLINING' : 'STABLE';
    };

    const scoreArr = recentScores.map((s) => s.score);
    const accArr = recentScores.map((s) => s.accuracy);
    const rankArr = recentScores.filter((s) => s.rank !== null).map((s) => s.rank as number);
    const percArr = recentScores.filter((s) => s.percentile !== null).map((s) => s.percentile as number);

    const trendSummary = {
      scoreTrend: calculateDirection(scoreArr) as any,
      accuracyTrend: calculateDirection(accArr) as any,
      rankTrend: calculateDirection(rankArr, true) as any, // lower rank is better
      percentileTrend: calculateDirection(percArr) as any,
      recentScores,
    };

    // 12. Contextual Recommendations
    const recommendations: DashboardRecommendationItem[] = [];
    if (subjects.length > 0) {
      const weakest = [...subjects].sort((a, b) => a.accuracy - b.accuracy)[0];
      const strongest = [...subjects].sort((a, b) => b.accuracy - a.accuracy)[0];

      if (weakest && weakest.accuracy < 70) {
        // Query an approved & accessible Subject-wise Mock Test
        const recommendedMock = await this.prisma.exam.findFirst({
          where: {
            status: {
              name: { in: ['APPROVED', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'ENDED'] },
            },
            ...(student.examTargetId
              ? {
                  OR: [
                    { examTargetId: student.examTargetId },
                    { examTarget: { name: 'General' } },
                  ],
                }
              : {}),
            sections: {
              some: {
                subjectId: weakest.subjectId,
              },
            },
          },
          select: {
            id: true,
            title: true,
            totalQuestions: true,
            durationMinutes: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (recommendedMock) {
          recommendations.push({
            id: 'rec-weak-subject',
            type: 'WARNING',
            message: `${weakest.subjectName} accuracy (${weakest.accuracy}%) is below target. Practice a subject-wise mock test to improve.`,
            actionLabel: `Practice ${weakest.subjectName} Mock Test`,
            actionType: 'PRACTICE_MOCK',
            targetUrl: `/student/mock-tests?mockTestId=${recommendedMock.id}`,
            subjectId: weakest.subjectId,
            subjectName: weakest.subjectName,
            mockTestId: recommendedMock.id,
            mockTestName: recommendedMock.title,
          });
        } else {
          recommendations.push({
            id: 'rec-weak-subject',
            type: 'WARNING',
            message: `${weakest.subjectName} accuracy (${weakest.accuracy}%) is below target. Focus revision on key concepts.`,
            actionLabel: null,
            actionType: 'PRACTICE_MOCK',
            targetUrl: null,
            subjectId: weakest.subjectId,
            subjectName: weakest.subjectName,
            mockTestId: null,
            mockTestName: null,
            fallbackMessage: 'No subject mock test is currently available.',
          });
        }
      }

      if (strongest && strongest.accuracy >= 80) {
        recommendations.push({
          id: 'rec-strong-subject',
          type: 'STRENGTH',
          message: `${strongest.subjectName} is your strongest subject with ${strongest.accuracy}% accuracy. Keep maintaining mastery.`,
        });
      }
    }

    if (attemptStrategy && attemptStrategy.avoidableNegativeMarks > 15) {
      recommendations.push({
        id: 'rec-strategy-risk',
        type: 'OPPORTUNITY',
        message: `You lost ~${attemptStrategy.avoidableNegativeMarks} marks to high-risk attempts. Eliminate guesswork to boost score.`,
        actionLabel: 'View Strategy Analysis',
        actionType: 'VIEW_STRATEGY',
        targetUrl: `/exam/result/${latestAttempt?.id}`,
      });
    }

    if (timeManagement && timeManagement.status === 'SLOW') {
      recommendations.push({
        id: 'rec-time-mgmt',
        type: 'TIP',
        message: `Average time per question (${timeManagement.averageTimePerQuestionSeconds}s) is high. Practice speed drills.`,
        actionLabel: 'View Time Analysis',
        actionType: 'VIEW_ANALYSIS',
        targetUrl: `/exam/result/${latestAttempt?.id}`,
      });
    }

    // 13. Recent Results Table (Latest 5 completed)
    const recentResults: RecentResultItem[] = [];
    const reversedEvaluated = [...evaluatedAttempts].reverse().slice(0, 5);

    reversedEvaluated.forEach((att) => {
      const res = att.result;
      const rankRecord = att.candidateRanks?.find((r) => r.rankType === 'OVERALL') || att.candidateRanks?.[0];
      recentResults.push({
        attemptId: att.id,
        examId: att.exam.id,
        examTitle: att.exam.title,
        examType: att.exam.examTarget?.name || student.examTarget?.name || 'NEET',
        date: att.serverEndTime
          ? new Date(att.serverEndTime).toISOString().split('T')[0]
          : new Date(att.createdAt).toISOString().split('T')[0],
        score: res?.totalScore || 0,
        maxScore: res?.maxScore || att.exam.totalMarks || 720,
        percentage: Math.round(Number(res?.percentage || 0) * 100) / 100,
        accuracy: Math.round(Number(res?.accuracy || 0) * 100) / 100,
        rank: rankRecord ? rankRecord.rank : null,
        totalCandidates: rankRecord ? rankRecord.totalCandidates : null,
        percentile: rankRecord ? rankRecord.percentile : null,
      });
    });

    // 14. Unread Notification Count
    const unreadCount = await this.prisma.notification.count({
      where: {
        OR: [{ userId }, { recipientUserId: userId }],
        isRead: false,
      },
    });

    const response: StudentDashboardResponse = {
      student: {
        studentId: student.studentId || student.studentCode || `BRN-${student.id.substring(0, 8).toUpperCase()}`,
        studentCode: student.studentCode,
        name: student.name || student.user?.name || 'Student',
        class: student.studentClass?.name || 'Class 12',
        examTarget: student.examTarget?.name || 'NEET',
        preferredLanguage: student.preferredLanguage?.name || 'English',
        email: student.user?.email,
        avatar: student.user?.avatarUrl,
      },
      nextExam,
      upcomingExams,
      activeAttempt,
      latestPerformance,
      rank,
      predictedRank,
      subjects,
      trendSummary,
      weakAreas,
      recommendations,
      timeManagement,
      attemptStrategy,
      recentResults,
      unreadNotificationCount: unreadCount,
    };

    // Cache in Redis for 60 seconds
    try {
      await this.redis.set(cacheKey, JSON.stringify(response), 60);
    } catch {
      // Ignore cache write error
    }

    return response;
  }
}
