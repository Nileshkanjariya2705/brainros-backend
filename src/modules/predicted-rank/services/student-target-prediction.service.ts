import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StudentTargetPredictionResult } from '../interfaces/predicted-rank.interface';

@Injectable()
export class StudentTargetPredictionService {
  private readonly logger = new Logger(StudentTargetPredictionService.name);
  private readonly MODEL_CODE = 'HISTORICAL_INTERPOLATION';
  private readonly MODEL_VERSION = 'v1.0.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Predict expected rank for a student based on target exam and historical dataset
   */
  async getStudentTargetPrediction(
    userId: string,
    targetExamOverride?: string,
  ): Promise<StudentTargetPredictionResult> {
    // 1. Fetch Student profile & Exam Target
    const student = await this.prisma.student.findFirst({
      where: { OR: [{ userId }, { id: userId }] },
      include: {
        examTarget: { select: { id: true, name: true } },
        studentExamTargets: { include: { examTarget: true } },
      },
    });

    if (!student) {
      return {
        available: false,
        reason: 'STUDENT_NOT_FOUND',
      };
    }

    // Determine target exam (e.g. JEE, NEET, CET)
    let rawTarget =
      targetExamOverride ||
      student.examTarget?.name ||
      student.studentExamTargets?.find((st) => st.isPrimary)?.examTarget?.name ||
      student.studentExamTargets?.[0]?.examTarget?.name;

    if (!rawTarget || rawTarget.trim() === '') {
      return {
        available: false,
        reason: 'NO_TARGET_EXAM',
      };
    }

    const normalizedTarget = this.normalizeTargetExamName(rawTarget);
    const targetExamCodes = this.getTargetExamQueryCodes(normalizedTarget);

    // Check Redis cache
    const cacheKey = `student:${student.id}:predicted-rank:${normalizedTarget}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore cache read errors
    }

    // 2. Fetch completed, evaluated attempts
    const attempts = await this.prisma.attempt.findMany({
      where: {
        studentId: student.id,
        status: { name: { in: ['EVALUATED', 'SUBMITTED', 'AUTO_SUBMITTED'] } },
        result: { isNot: null },
      },
      include: {
        exam: {
          include: { examTarget: true },
        },
        result: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Filter valid results
    const validAttempts = attempts.filter(
      (a) =>
        a.result &&
        a.result.maxScore > 0 &&
        a.result.percentage !== null &&
        a.result.percentage >= 0,
    );

    if (validAttempts.length === 0) {
      return {
        available: false,
        reason: 'INSUFFICIENT_DATA',
        targetExam: normalizedTarget,
        targetExamName: this.getDisplayExamName(normalizedTarget),
      };
    }

    // 3. Handle multiple mock attempts & repeated tests
    // Group attempts by examId to avoid inflation from retaking the exact same mock test 10 times
    const examAttemptsMap = new Map<string, typeof validAttempts>();
    for (const att of validAttempts) {
      const key = att.examId;
      if (!examAttemptsMap.has(key)) {
        examAttemptsMap.set(key, []);
      }
      examAttemptsMap.get(key)!.push(att);
    }

    // For each unique exam, aggregate attempts (latest attempt 70%, average of others 30%)
    interface AggregatedTestPoint {
      examId: string;
      percentage: number;
      score: number;
      maxScore: number;
      accuracy: number;
      attemptCount: number;
      createdAt: Date;
    }

    const testPoints: AggregatedTestPoint[] = [];
    for (const [examId, attList] of examAttemptsMap.entries()) {
      // Sort newest to oldest
      attList.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const latest = attList[0];
      let representativePercentage = latest.result!.percentage;
      let representativeScore = latest.result!.totalScore;
      let representativeAccuracy = latest.result!.accuracy;

      if (attList.length > 1) {
        // Average the earlier attempts to dampen learning-by-repetition effect
        const priorAttempts = attList.slice(1);
        const priorAvgPerc =
          priorAttempts.reduce((s, a) => s + (a.result?.percentage || 0), 0) /
          priorAttempts.length;
        const priorAvgScore =
          priorAttempts.reduce((s, a) => s + (a.result?.totalScore || 0), 0) /
          priorAttempts.length;

        // Blended score gives 70% weight to first/latest and 30% to historical avg
        representativePercentage =
          latest.result!.percentage * 0.7 + priorAvgPerc * 0.3;
        representativeScore =
          latest.result!.totalScore * 0.7 + priorAvgScore * 0.3;
      }

      testPoints.push({
        examId,
        percentage: representativePercentage,
        score: representativeScore,
        maxScore: latest.result!.maxScore,
        accuracy: representativeAccuracy,
        attemptCount: attList.length,
        createdAt: latest.createdAt,
      });
    }

    // Sort test points by creation date (newest first)
    testPoints.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // 4. Recency-weighted Student Performance
    // Weights: [0.50, 0.30, 0.20] for top 3, or dynamic for 1-2 points
    const topPoints = testPoints.slice(0, 5);
    const weights = this.calculateRecencyWeights(topPoints.length);

    let weightedPercentage = 0;
    let weightedAccuracy = 0;
    for (let i = 0; i < topPoints.length; i++) {
      weightedPercentage += topPoints[i].percentage * weights[i];
      weightedAccuracy += topPoints[i].accuracy * weights[i];
    }
    weightedPercentage = Math.round(weightedPercentage * 100) / 100;
    weightedAccuracy = Math.round(weightedAccuracy * 100) / 100;

    // 5. Performance Trend
    let trend: 'IMPROVING' | 'STABLE' | 'DECLINING' = 'STABLE';
    if (topPoints.length >= 2) {
      const recentPerc = topPoints[0].percentage;
      const olderPerc =
        topPoints.slice(1).reduce((s, p) => s + p.percentage, 0) /
        (topPoints.length - 1);
      const delta = recentPerc - olderPerc;
      if (delta >= 2.5) {
        trend = 'IMPROVING';
      } else if (delta <= -2.5) {
        trend = 'DECLINING';
      }
    }

    // 6. Fetch Target Historical Datasets (Strict Isolation)
    const historicalExams = await this.prisma.historicalExam.findMany({
      where: {
        examType: { in: targetExamCodes },
        dataQualityStatus: 'VALID',
        scoreRanges: { some: {} },
      },
      include: {
        scoreRanges: {
          orderBy: { minScore: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (historicalExams.length === 0) {
      return {
        available: false,
        reason: 'PREDICTION_UNAVAILABLE',
        targetExam: normalizedTarget,
        targetExamName: this.getDisplayExamName(normalizedTarget),
      };
    }

    // 7. Multi-Year Historical Weighting & Interpolation
    // Weight recent historical years higher (e.g. 2025: 1.0, 2024: 0.85, 2023: 0.70)
    const historicalPredictions: {
      examName: string;
      year: number;
      weight: number;
      rank: number;
      totalCandidates: number;
    }[] = [];

    const historicalYearsUsed: number[] = [];

    for (const hExam of historicalExams) {
      const year = this.extractExamYear(hExam.examName, hExam.examDate);
      if (!historicalYearsUsed.includes(year)) {
        historicalYearsUsed.push(year);
      }

      const yearWeight = this.getYearWeight(year);
      const targetScore =
        Math.round(((weightedPercentage / 100) * hExam.totalMarks) * 100) / 100;

      const interpolatedRank = this.interpolateRank(
        targetScore,
        hExam.scoreRanges,
        hExam.totalCandidates,
      );

      historicalPredictions.push({
        examName: hExam.examName,
        year,
        weight: yearWeight,
        rank: interpolatedRank,
        totalCandidates: hExam.totalCandidates,
      });
    }

    historicalYearsUsed.sort((a, b) => b - a);

    // Weighted average predicted rank across historical datasets
    const totalHistoricalWeight = historicalPredictions.reduce(
      (s, p) => s + p.weight,
      0,
    );
    const rawPredictedRank =
      totalHistoricalWeight > 0
        ? Math.round(
            historicalPredictions.reduce(
              (s, p) => s + p.rank * p.weight,
              0,
            ) / totalHistoricalWeight,
          )
        : Math.round(historicalPredictions[0].rank);

    const predictedRank = Math.max(1, rawPredictedRank);

    // 8. Dynamic Expected Rank Range Calculation
    // Spread based on variance, candidate pool, and student stability
    const rankList = historicalPredictions.map((p) => p.rank);
    const minHistoricalRank = Math.min(...rankList);
    const maxHistoricalRank = Math.max(...rankList);
    const avgTotalCandidates =
      historicalPredictions.reduce((s, p) => s + p.totalCandidates, 0) /
      historicalPredictions.length;

    // Student variance across tests
    const studentVariance = this.calculatePercentageVariance(
      topPoints.map((p) => p.percentage),
    );

    // Spread factor (min 5%, max 25% depending on stability)
    let spreadFactor = 0.08;
    if (topPoints.length === 1) spreadFactor = 0.20;
    else if (topPoints.length === 2) spreadFactor = 0.14;
    else if (studentVariance > 15) spreadFactor = 0.18;
    else if (studentVariance < 3) spreadFactor = 0.05;

    const rankSpread = Math.max(
      10,
      Math.ceil(predictedRank * spreadFactor),
    );

    const rankRangeMin = Math.max(
      1,
      Math.min(minHistoricalRank, predictedRank - rankSpread),
    );
    const rankRangeMax = Math.min(
      Math.round(avgTotalCandidates),
      Math.max(maxHistoricalRank, predictedRank + rankSpread),
    );

    // 9. Confidence Level (HIGH, MEDIUM, LOW)
    let confidenceScore = 25; // baseline

    // Number of distinct attempt tests
    if (topPoints.length >= 4) confidenceScore += 40;
    else if (topPoints.length >= 2) confidenceScore += 25;
    else if (topPoints.length === 1) confidenceScore += 10;

    // Score consistency bonus
    if (topPoints.length >= 2) {
      if (studentVariance <= 3.0) confidenceScore += 15;
      else if (studentVariance <= 8.0) confidenceScore += 8;
      else if (studentVariance > 20.0) confidenceScore -= 15;
    }

    // Historical dataset depth
    if (historicalYearsUsed.length >= 2) confidenceScore += 10;
    if (avgTotalCandidates >= 50000) confidenceScore += 5;

    // Single attempt is capped to max 45 (LOW)
    if (topPoints.length === 1) {
      confidenceScore = Math.min(45, confidenceScore);
    }

    confidenceScore = Math.max(10, Math.min(95, confidenceScore));

    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
      confidenceScore >= 75
        ? 'HIGH'
        : confidenceScore >= 50
          ? 'MEDIUM'
          : 'LOW';

    // Target standard marks for reference (NEET: 720, JEE: 300, CET: 200)
    const targetStandardMarks = this.getTargetStandardTotalMarks(normalizedTarget);
    const normalizedScoreUsed =
      Math.round(((weightedPercentage / 100) * targetStandardMarks) * 10) / 10;

    const result: StudentTargetPredictionResult = {
      available: true,
      targetExam: normalizedTarget,
      targetExamName: this.getDisplayExamName(normalizedTarget),
      predictedRank,
      rankRange: {
        min: rankRangeMin,
        max: rankRangeMax,
      },
      confidence,
      confidenceScore,
      scoreUsed: normalizedScoreUsed,
      normalizedPercentage: weightedPercentage,
      attemptsUsed: validAttempts.length,
      historicalYearsUsed,
      trend,
      modelCode: this.MODEL_CODE,
      modelVersion: this.MODEL_VERSION,
      explanation: `Predicted rank calculated using ${historicalYearsUsed.length} verified historical ${this.getDisplayExamName(normalizedTarget)} datasets and ${validAttempts.length} evaluated attempt(s).`,
      generatedAt: new Date().toISOString(),
    };

    // Cache in Redis (TTL: 1 hour)
    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 3600);
    } catch {
      // Ignore cache write error
    }

    return result;
  }

  /**
   * Invalidate cached prediction for a student
   */
  async invalidateStudentPredictionCache(studentId: string): Promise<void> {
    const targets = ['JEE', 'NEET', 'CET', 'JEE_MAIN', 'MHT_CET'];
    for (const t of targets) {
      try {
        await this.redis.del(`student:${studentId}:predicted-rank:${t}`);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Piecewise linear inverse interpolation on historical score ranges
   */
  private interpolateRank(
    score: number,
    ranges: {
      minScore: number;
      maxScore: number;
      representativeScore: number;
      minRank: number;
      maxRank: number;
    }[],
    totalCandidates: number,
  ): number {
    if (!ranges || ranges.length === 0) return totalCandidates;

    const sorted = [...ranges].sort(
      (a, b) => a.representativeScore - b.representativeScore,
    );

    const minObserved = sorted[0].minScore;
    const maxObserved = sorted[sorted.length - 1].maxScore;

    // Boundary handling: score higher than maximum observed -> Rank 1
    if (score >= maxObserved) {
      return 1;
    }

    // Boundary handling: score lower than lowest observed -> lowest rank
    if (score <= minObserved) {
      return totalCandidates;
    }

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];

      // Inside exact range bucket
      if (score >= curr.minScore && score <= curr.maxScore) {
        if (curr.maxScore === curr.minScore) return curr.minRank;
        const bucketRatio =
          (score - curr.minScore) / (curr.maxScore - curr.minScore);
        // Inverse relationship: higher score -> lower rank number (closer to minRank)
        const rank =
          curr.maxRank - bucketRatio * (curr.maxRank - curr.minRank);
        return Math.max(1, Math.round(rank));
      }

      // Between bucket i and bucket i+1
      if (i < sorted.length - 1) {
        const next = sorted[i + 1];
        if (score > curr.maxScore && score < next.minScore) {
          const s1 = curr.representativeScore;
          const s2 = next.representativeScore;
          const r1 = curr.minRank;
          const r2 = next.minRank;

          if (s2 === s1) return Math.round(r1);

          const ratio = (score - s1) / (s2 - s1);
          // Inverse: r2 is better (smaller) than r1
          const rank = r1 + ratio * (r2 - r1);
          return Math.max(1, Math.min(totalCandidates, Math.round(rank)));
        }
      }
    }

    return totalCandidates;
  }

  /**
   * Recency weights for n test points
   */
  private calculateRecencyWeights(count: number): number[] {
    if (count <= 0) return [];
    if (count === 1) return [1.0];
    if (count === 2) return [0.65, 0.35];
    if (count === 3) return [0.50, 0.30, 0.20];
    if (count === 4) return [0.40, 0.30, 0.20, 0.10];

    // Count 5: [0.35, 0.25, 0.20, 0.12, 0.08]
    return [0.35, 0.25, 0.20, 0.12, 0.08];
  }

  /**
   * Normalizes arbitrary target exam strings into standard keys: JEE | NEET | CET
   */
  private normalizeTargetExamName(name: string): 'JEE' | 'NEET' | 'CET' {
    const upper = name.toUpperCase().replace(/[\s\-_]/g, '');
    if (upper.includes('NEET')) return 'NEET';
    if (upper.includes('JEE') || upper.includes('IIT')) return 'JEE';
    if (upper.includes('CET') || upper.includes('MHT') || upper.includes('KCET'))
      return 'CET';
    return 'JEE';
  }

  /**
   * DB query codes for target exam
   */
  private getTargetExamQueryCodes(normalized: 'JEE' | 'NEET' | 'CET'): string[] {
    switch (normalized) {
      case 'JEE':
        return ['JEE', 'JEE_MAIN', 'JEE_ADVANCED', 'IIT_JEE'];
      case 'NEET':
        return ['NEET', 'NEET_UG', 'NEET_PG'];
      case 'CET':
        return ['CET', 'MHT_CET', 'KCET', 'GUJCET'];
    }
  }

  /**
   * Display name for frontend
   */
  private getDisplayExamName(normalized: 'JEE' | 'NEET' | 'CET'): string {
    switch (normalized) {
      case 'JEE':
        return 'JEE Main';
      case 'NEET':
        return 'NEET UG';
      case 'CET':
        return 'State CET / MHT-CET';
    }
  }

  /**
   * Standard total marks per exam
   */
  private getTargetStandardTotalMarks(normalized: 'JEE' | 'NEET' | 'CET'): number {
    switch (normalized) {
      case 'JEE':
        return 300;
      case 'NEET':
        return 720;
      case 'CET':
        return 200;
    }
  }

  /**
   * Extract year from exam name or date
   */
  private extractExamYear(name: string, date?: Date | null): number {
    const match = name.match(/20\d\d/);
    if (match) return parseInt(match[0], 10);
    if (date) return new Date(date).getFullYear();
    return new Date().getFullYear();
  }

  /**
   * Year recency weighting
   */
  private getYearWeight(year: number): number {
    const currentYear = new Date().getFullYear();
    const diff = currentYear - year;
    if (diff <= 0) return 1.0;
    if (diff === 1) return 0.85;
    if (diff === 2) return 0.70;
    if (diff === 3) return 0.55;
    return 0.40;
  }

  /**
   * Compute variance among numbers
   */
  private calculatePercentageVariance(numbers: number[]): number {
    if (numbers.length <= 1) return 0;
    const mean = numbers.reduce((s, n) => s + n, 0) / numbers.length;
    const sqDiffs = numbers.map((n) => Math.pow(n - mean, 2));
    const avgSqDiff = sqDiffs.reduce((s, n) => s + n, 0) / numbers.length;
    return Math.sqrt(avgSqDiff);
  }
}
