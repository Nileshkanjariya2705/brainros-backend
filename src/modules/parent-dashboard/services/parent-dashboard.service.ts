import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ParentStudentAccessService } from './parent-student-access.service';
import { StudentTrendService } from '../../performance-trend/services/student-trend.service';
import { GetTrendsQueryDto } from '../../performance-trend/dto/performance-trend.dto';
import {
  ParentDashboardResponse,
  ParentStudentOverviewItem,
  ParentRecentTestItem,
  ParentRecommendationItem,
  ParentSubjectSummaryItem,
} from '../interfaces/parent-dashboard.interface';

@Injectable()
export class ParentDashboardService {
  private readonly logger = new Logger(ParentDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accessService: ParentStudentAccessService,
    private readonly trendService: StudentTrendService,
  ) {}

  /**
   * Multi-Student Overview for parent's home screen
   */
  async getMultiStudentOverview(parentId: string): Promise<ParentStudentOverviewItem[]> {
    const students = await this.accessService.getAuthorizedStudents(parentId);
    if (students.length === 0) return [];

    const overviewList: ParentStudentOverviewItem[] = [];

    for (const st of students) {
      const attempts = await this.prisma.attempt.findMany({
        where: {
          studentId: st.id,
          result: { isNot: null },
          status: { name: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
        },
        include: {
          result: true,
          candidateRanks: {
            where: { rankType: 'OVERALL' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const testsAttempted = attempts.length;
      const latestAttempt = attempts[0] as any;
      const latestResult = latestAttempt?.result;
      const latestRankRecord = latestAttempt?.candidateRanks?.[0];

      // Estimate attendance based on available scheduled exams
      const totalSchedules = await this.prisma.examSchedule.count({
        where: { status: { in: ['SCHEDULED', 'ACTIVE'] } },
      });
      const attendancePercentage =
        totalSchedules > 0 ? Math.min(100, Math.round((testsAttempted / totalSchedules) * 100)) : 100;

      overviewList.push({
        studentId: st.id,
        name: st.name,
        studentCode: st.studentId,
        examTarget: st.examTarget?.name,
        latestScore: latestResult?.totalScore ?? 0,
        latestPercentage: latestResult?.percentage ?? 0,
        latestAccuracy: latestResult?.accuracy ?? 0,
        latestRank: latestRankRecord?.rank ?? null,
        latestPercentile: latestRankRecord?.percentile ?? null,
        testsAttempted,
        attendancePercentage,
        lastTestDate: latestAttempt?.serverEndTime
          ? new Date(latestAttempt.serverEndTime).toISOString().split('T')[0]
          : null,
      });
    }

    return overviewList;
  }

  /**
   * Detailed Student Dashboard for parent
   */
  async getStudentDashboard(parentId: string, studentId: string): Promise<ParentDashboardResponse> {
    // 1. Enforce strict authorization
    const student = await this.accessService.assertCanAccessStudent(parentId, studentId);

    // 2. Check Redis Cache
    const cacheKey = `parent:${parentId}:student:${student.id}:dashboard`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for parent '${parentId}' student '${student.id}' dashboard`);
      return JSON.parse(cached);
    }

    // 3. Load all evaluated attempts with joined relations
    const attempts: any[] = await this.prisma.attempt.findMany({
      where: {
        studentId: student.id,
        result: { isNot: null },
        status: { name: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
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
        predictionResults: {
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' }, // Chronological order
    });

    const testsAttempted = attempts.length;

    // Summary calculations
    let totalScoreSum = 0;
    let totalAccuracySum = 0;
    let bestScore = 0;

    attempts.forEach((att) => {
      const score = att.result?.totalScore ?? 0;
      const accuracy = att.result?.accuracy ?? 0;
      totalScoreSum += score;
      totalAccuracySum += accuracy;
      if (score > bestScore) bestScore = score;
    });

    const averageScore = testsAttempted > 0 ? Math.round(totalScoreSum / testsAttempted) : 0;
    const averageAccuracy =
      testsAttempted > 0 ? Math.round((totalAccuracySum / testsAttempted) * 10) / 10 : 0;

    const firstAttempt = attempts[0];
    const latestAttempt = attempts[attempts.length - 1];

    const latestScore = latestAttempt?.result?.totalScore ?? 0;
    const latestAccuracy = latestAttempt?.result?.accuracy ?? 0;
    const scoreImprovement = firstAttempt ? latestScore - (firstAttempt.result?.totalScore ?? 0) : 0;

    const latestRankRecord = latestAttempt?.candidateRanks?.[0];
    const latestRank = latestRankRecord?.rank ?? null;
    const latestPercentile = latestRankRecord?.percentile ?? null;
    const totalCandidates = latestRankRecord?.totalCandidates ?? null;

    // Attendance
    const totalSchedules = await this.prisma.examSchedule.count({
      where: { status: { in: ['SCHEDULED', 'ACTIVE'] } },
    });
    const attendancePercentage =
      totalSchedules > 0 ? Math.min(100, Math.round((testsAttempted / totalSchedules) * 100)) : 100;

    // Subjects from latest attempt
    const subjectList: ParentSubjectSummaryItem[] = [];
    const latestSubjectResults = latestAttempt?.result?.subjectResults || [];

    for (const sub of latestSubjectResults) {
      const acc = sub.accuracy ?? 0;
      let status = 'GOOD';
      if (acc >= 90) status = 'EXCELLENT';
      else if (acc >= 75) status = 'STRONG';
      else if (acc >= 60) status = 'GOOD';
      else if (acc >= 40) status = 'WEAK';
      else status = 'CRITICAL';

      subjectList.push({
        subjectId: sub.subjectId,
        name: sub.subject?.name || 'Subject',
        score: sub.score ?? 0,
        maxScore: sub.maxScore ?? 0,
        accuracy: acc,
        percentage: sub.percentage ?? (sub.maxScore > 0 ? Math.round((sub.score / sub.maxScore) * 100) : 0),
        status,
      });
    }

    const sortedByAcc = [...subjectList].sort((a, b) => b.accuracy - a.accuracy);
    const strongestSubject = sortedByAcc[0]
      ? { subjectId: sortedByAcc[0].subjectId, name: sortedByAcc[0].name, accuracy: sortedByAcc[0].accuracy }
      : null;
    const weakestSubject = sortedByAcc[sortedByAcc.length - 1]
      ? {
          subjectId: sortedByAcc[sortedByAcc.length - 1].subjectId,
          name: sortedByAcc[sortedByAcc.length - 1].name,
          accuracy: sortedByAcc[sortedByAcc.length - 1].accuracy,
        }
      : null;

    // Time Management from latest attempt
    const latestTime = latestAttempt?.timeAnalyses?.[0];
    const avgTimePerQuestion = latestTime?.averageTimePerQuestionSeconds ?? 60.0;
    const timeUtil = latestTime?.timeUtilizationPercentage ?? 85.0;
    const highTimeWrong = (latestTime?.data as any)?.paceBreakdown?.timeWastedQuestions ?? 0;

    let timeStatus: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' = 'GOOD';
    let timeObservation = 'Time utilization and pacing are well-managed across test sections.';

    if (timeUtil > 95 && avgTimePerQuestion > 80) {
      timeStatus = 'NEEDS_IMPROVEMENT';
      timeObservation =
        'Recent tests indicate that the student spent extended time on challenging questions, leading to a hurried finish.';
    } else if (timeUtil >= 80 && avgTimePerQuestion <= 65) {
      timeStatus = 'EXCELLENT';
      timeObservation = 'Excellent pacing with balanced question coverage and time preservation for review.';
    }

    // Predicted Rank
    const latestPred = latestAttempt?.predictionResults?.[0];
    const predictedRank = latestPred
      ? {
          rankMin: latestPred.predictedRankMin ?? 0,
          rankMax: latestPred.predictedRankMax ?? 0,
          confidence: latestPred.confidence ?? 'MEDIUM',
          modelVersion: latestPred.modelVersion ?? 'v1.0.0',
          disclaimer:
            'Statistical projected rank based on historical exam score distributions. Not an official rank.',
        }
      : null;

    // Parent-Safe Recommendations
    const recommendations: ParentRecommendationItem[] = [];

    if (weakestSubject && weakestSubject.accuracy < 75) {
      recommendations.push({
        category: 'SUBJECT',
        severity: weakestSubject.accuracy < 50 ? 'HIGH' : 'MEDIUM',
        title: `Focus on ${weakestSubject.name} Revisions`,
        message: `${weakestSubject.name} accuracy is currently at ${weakestSubject.accuracy}%. Targeted problem-solving and topic revisions will yield immediate score improvements.`,
      });
    }

    if (timeStatus === 'NEEDS_IMPROVEMENT') {
      recommendations.push({
        category: 'TIME_MANAGEMENT',
        severity: 'MEDIUM',
        title: 'Improve Question Time Allocation',
        message:
          'Several recent tests show high time spent on incorrect questions. Encourage the student to skip and review harder questions in a second pass.',
      });
    }

    if (scoreImprovement > 0) {
      recommendations.push({
        category: 'ACCURACY',
        severity: 'LOW',
        title: 'Positive Growth Trajectory',
        message: `Your child has achieved a +${scoreImprovement} score increase since their first mock exam. Consistent practice is showing clear results.`,
      });
    }

    // Recent 5 Tests
    const recentAttempts = [...attempts].reverse().slice(0, 5);
    const recentTests: ParentRecentTestItem[] = recentAttempts.map((att) => {
      const res = att.result || {};
      const rk = att.candidateRanks?.[0];
      return {
        attemptId: att.id,
        examName: att.exam.title,
        examType: att.exam.examTarget?.name || 'GENERAL',
        date: att.serverEndTime
          ? new Date(att.serverEndTime).toISOString().split('T')[0]
          : new Date(att.createdAt).toISOString().split('T')[0],
        score: res.totalScore ?? 0,
        maxScore: res.maxScore ?? att.exam.totalMarks ?? 720,
        percentage: res.percentage ?? 0,
        accuracy: res.accuracy ?? 0,
        rank: rk?.rank ?? null,
        percentile: rk?.percentile ?? null,
      };
    });

    const response: ParentDashboardResponse = {
      student: {
        studentId: student.id,
        name: student.name,
        studentCode: student.studentId,
        grade: student.studentClass?.name,
        schoolCollege: student.schoolCollege,
        examTarget: student.examTarget?.name,
        state: student.state,
        district: student.district,
      },
      summary: {
        testsAttempted,
        averageScore,
        latestScore,
        bestScore,
        scoreImprovement,
        averageAccuracy,
        latestAccuracy,
        latestRank,
        latestPercentile,
        attendancePercentage,
      },
      subjects: {
        strongest: strongestSubject,
        weakest: weakestSubject,
        all: subjectList,
      },
      attendance: {
        scheduledCount: totalSchedules,
        attendedCount: testsAttempted,
        missedCount: Math.max(0, totalSchedules - testsAttempted),
        attendancePercentage,
      },
      timeManagement: {
        averageTimePerQuestionSeconds: Math.round(avgTimePerQuestion * 10) / 10,
        timeUtilizationPercentage: Math.round(timeUtil * 10) / 10,
        highTimeWrongCount: highTimeWrong,
        status: timeStatus,
        observation: timeObservation,
      },
      rank: {
        official: {
          rank: latestRank,
          totalCandidates,
          percentile: latestPercentile,
        },
        predicted: predictedRank,
      },
      recommendations,
      recentTests,
    };

    // 4. Cache in Redis for 10 minutes
    await this.redisService.set(cacheKey, JSON.stringify(response), 600);

    return response;
  }

  /**
   * Get Student Trends for Parent View
   */
  async getStudentTrends(parentId: string, studentId: string, filters: GetTrendsQueryDto) {
    const student = await this.accessService.assertCanAccessStudent(parentId, studentId);
    return this.trendService.getStudentTrends(student.id, filters);
  }

  /**
   * Invalidate parent dashboard cache for a student
   */
  async invalidateParentCache(studentId: string) {
    const pattern = `parent:*:student:${studentId}:dashboard`;
    const keys = await this.redisService.keys(pattern);
    for (const key of keys) {
      await this.redisService.del(key);
    }
  }
}
