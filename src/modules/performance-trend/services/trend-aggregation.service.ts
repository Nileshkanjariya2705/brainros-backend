import { Injectable } from '@nestjs/common';
import {
  MockDataPoint,
  ScoreTrendPoint,
  AccuracyTrendPoint,
  RankTrendPoint,
  PercentileTrendPoint,
  TimeTrendPoint,
  SubjectTrendSeries,
  TrendSummary,
  PerformanceTrendsResponse,
  TrendInsight,
  TrendDirection,
} from '../interfaces/performance-trend.interface';

@Injectable()
export class TrendAggregationService {
  /**
   * Aggregate raw attempt results into structured, chart-ready performance trends
   */
  aggregateTrends(rawAttempts: any[]): PerformanceTrendsResponse {
    if (!rawAttempts || rawAttempts.length === 0) {
      return {
        summary: {
          totalMocks: 0,
          firstMock: null,
          latestMock: null,
          bestMock: null,
          worstMock: null,
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
        mocks: [],
        scoreTrend: [],
        accuracyTrend: [],
        rankTrend: [],
        percentileTrend: [],
        timeTrend: [],
        subjectTrends: [],
        trendInsights: [],
      };
    }

    const mocks: MockDataPoint[] = [];
    const scoreTrend: ScoreTrendPoint[] = [];
    const accuracyTrend: AccuracyTrendPoint[] = [];
    const rankTrend: RankTrendPoint[] = [];
    const percentileTrend: PercentileTrendPoint[] = [];
    const timeTrend: TimeTrendPoint[] = [];
    const subjectMap = new Map<string, { subjectId: string; subjectName: string; points: any[] }>();

    rawAttempts.forEach((att, idx) => {
      const mockNumber = idx + 1;
      const label = `Mock ${mockNumber}`;
      const date = att.serverEndTime
        ? new Date(att.serverEndTime).toISOString().split('T')[0]
        : new Date(att.createdAt).toISOString().split('T')[0];

      const res = att.result || {};
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
      const timeUtilizationPercentage = timeRecord ? timeRecord.timeUtilizationPercentage : null;
      const averageTimePerQuestion = timeRecord ? timeRecord.averageTimePerQuestionSeconds : res.averageTimePerQuestion ?? null;

      const mockPoint: MockDataPoint = {
        attemptId: att.id,
        examId: att.examId,
        examTitle: att.exam.title,
        examType: att.exam.examTarget?.name || 'GENERAL',
        mockNumber,
        label,
        date,
        score,
        maxScore,
        percentage,
        accuracy,
        rank,
        totalCandidates,
        percentile,
        timeUsedSeconds,
        timeUtilizationPercentage,
      };

      mocks.push(mockPoint);

      // Score Series
      scoreTrend.push({
        attemptId: att.id,
        label,
        date,
        score,
        maximumScore: maxScore,
        percentage,
      });

      // Accuracy Series
      accuracyTrend.push({
        attemptId: att.id,
        label,
        date,
        accuracy,
      });

      // Rank Series
      rankTrend.push({
        attemptId: att.id,
        label,
        date,
        rank,
        totalCandidates,
        percentile,
      });

      // Percentile Series
      percentileTrend.push({
        attemptId: att.id,
        label,
        date,
        percentile,
      });

      // Time Series
      timeTrend.push({
        attemptId: att.id,
        label,
        date,
        timeUsedSeconds,
        timeUtilizationPercentage,
        averageTimePerQuestion,
      });

      // Subject breakdown series
      const subjectResults = res.subjectResults || [];
      for (const sRes of subjectResults) {
        const sId = sRes.subjectId;
        const sName = sRes.subject?.name || 'Unknown Subject';

        if (!subjectMap.has(sId)) {
          subjectMap.set(sId, { subjectId: sId, subjectName: sName, points: [] });
        }

        subjectMap.get(sId)!.points.push({
          attemptId: att.id,
          label,
          date,
          accuracy: sRes.accuracy ?? 0,
          percentage: sRes.percentage ?? (sRes.maxScore > 0 ? (sRes.score / sRes.maxScore) * 100 : 0),
          score: sRes.score ?? 0,
          maxScore: sRes.maxScore ?? 0,
        });
      }
    });

    const subjectTrends: SubjectTrendSeries[] = Array.from(subjectMap.values());

    // Compute Summary Deltas & Directions
    const firstMock = mocks[0];
    const latestMock = mocks[mocks.length - 1];

    // Find Best & Worst Mocks (by percentage)
    const sortedByScore = [...mocks].sort((a, b) => b.percentage - a.percentage);
    const bestMock = sortedByScore[0];
    const worstMock = sortedByScore[sortedByScore.length - 1];

    const scoreDelta = Math.round((latestMock.score - firstMock.score) * 100) / 100;
    const percentageDelta = Math.round((latestMock.percentage - firstMock.percentage) * 100) / 100;
    const accuracyDelta = Math.round((latestMock.accuracy - firstMock.accuracy) * 100) / 100;

    const rankDelta =
      latestMock.rank !== null && firstMock.rank !== null ? latestMock.rank - firstMock.rank : null;
    const rankImprovement = rankDelta !== null ? -rankDelta : null; // Positive when rank number improved

    const percentileDelta =
      latestMock.percentile !== null && firstMock.percentile !== null
        ? Math.round((latestMock.percentile - firstMock.percentile) * 100) / 100
        : null;

    const timeUsedDeltaSeconds =
      latestMock.timeUsedSeconds !== null && firstMock.timeUsedSeconds !== null
        ? latestMock.timeUsedSeconds - firstMock.timeUsedSeconds
        : null;

    // Trend Direction Classification
    const scoreTrendDir = this.classifyDirection(scoreDelta, 2.0);
    const accuracyTrendDir = this.classifyDirection(accuracyDelta, 1.5);
    const rankTrendDir: TrendDirection =
      rankImprovement === null ? 'INSUFFICIENT_DATA' : rankImprovement > 0 ? 'IMPROVING' : rankImprovement < 0 ? 'DECLINING' : 'STABLE';
    const percentileTrendDir = percentileDelta === null ? 'INSUFFICIENT_DATA' : this.classifyDirection(percentileDelta, 0.5);

    // Subject Improvements
    let mostImprovedSubject: TrendSummary['mostImprovedSubject'] = null;
    let strongestCurrentSubject: TrendSummary['strongestCurrentSubject'] = null;
    let weakestCurrentSubject: TrendSummary['weakestCurrentSubject'] = null;

    if (subjectTrends.length > 0) {
      let maxAccDelta = -Infinity;
      let maxLatestAcc = -Infinity;
      let minLatestAcc = Infinity;

      for (const s of subjectTrends) {
        if (s.points.length >= 2) {
          const firstPoint = s.points[0];
          const lastPoint = s.points[s.points.length - 1];
          const delta = Math.round((lastPoint.accuracy - firstPoint.accuracy) * 10) / 10;
          if (delta > maxAccDelta) {
            maxAccDelta = delta;
            mostImprovedSubject = { subjectId: s.subjectId, subjectName: s.subjectName, accuracyDelta: delta };
          }
        }

        const latestPoint = s.points[s.points.length - 1];
        if (latestPoint) {
          if (latestPoint.accuracy > maxLatestAcc) {
            maxLatestAcc = latestPoint.accuracy;
            strongestCurrentSubject = { subjectId: s.subjectId, subjectName: s.subjectName, latestAccuracy: latestPoint.accuracy };
          }
          if (latestPoint.accuracy < minLatestAcc) {
            minLatestAcc = latestPoint.accuracy;
            weakestCurrentSubject = { subjectId: s.subjectId, subjectName: s.subjectName, latestAccuracy: latestPoint.accuracy };
          }
        }
      }
    }

    // Generate Insights
    const trendInsights: TrendInsight[] = [];
    if (scoreDelta > 0) {
      trendInsights.push({
        type: 'POSITIVE',
        metric: 'SCORE',
        message: `Your score improved by +${scoreDelta} marks (${percentageDelta > 0 ? `+${percentageDelta}%` : `${percentageDelta}%`}) across ${mocks.length} mock exams.`,
      });
    }
    if (accuracyDelta > 0) {
      trendInsights.push({
        type: 'POSITIVE',
        metric: 'ACCURACY',
        message: `Your solving accuracy climbed to ${latestMock.accuracy}% (+${accuracyDelta}% gain).`,
      });
    }
    if (mostImprovedSubject && mostImprovedSubject.accuracyDelta > 0) {
      trendInsights.push({
        type: 'POSITIVE',
        metric: 'SUBJECT',
        message: `${mostImprovedSubject.subjectName} is your most improved subject (+${mostImprovedSubject.accuracyDelta}% accuracy gain).`,
      });
    }
    if (weakestCurrentSubject && weakestCurrentSubject.latestAccuracy < 70) {
      trendInsights.push({
        type: 'WARNING',
        metric: 'SUBJECT',
        message: `${weakestCurrentSubject.subjectName} has your lowest recent accuracy (${weakestCurrentSubject.latestAccuracy}%). Prioritize revisions in this area.`,
      });
    }

    const summary: TrendSummary = {
      totalMocks: mocks.length,
      firstMock,
      latestMock,
      bestMock,
      worstMock,
      scoreDelta,
      percentageDelta,
      accuracyDelta,
      rankDelta,
      rankImprovement,
      percentileDelta,
      timeUsedDeltaSeconds,
      trendDirections: {
        scoreTrend: scoreTrendDir,
        accuracyTrend: accuracyTrendDir,
        rankTrend: rankTrendDir,
        percentileTrend: percentileTrendDir,
      },
      mostImprovedSubject,
      strongestCurrentSubject,
      weakestCurrentSubject,
    };

    return {
      summary,
      mocks,
      scoreTrend,
      accuracyTrend,
      rankTrend,
      percentileTrend,
      timeTrend,
      subjectTrends,
      trendInsights,
    };
  }

  private classifyDirection(delta: number, threshold: number): TrendDirection {
    if (delta >= threshold) return 'IMPROVING';
    if (delta <= -threshold) return 'DECLINING';
    return 'STABLE';
  }
}
