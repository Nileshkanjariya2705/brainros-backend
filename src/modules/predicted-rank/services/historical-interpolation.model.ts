import { Injectable } from '@nestjs/common';
import {
  RankPredictionModel,
  PredictionInput,
  PredictionOutput,
  SelectedHistoricalDataset,
} from '../interfaces/predicted-rank.interface';

@Injectable()
export class HistoricalInterpolationModel implements RankPredictionModel {
  private readonly MODEL_CODE = 'HISTORICAL_INTERPOLATION';
  private readonly MODEL_VERSION = 'v1.0.0';

  /**
   * Predict rank range using deterministic historical score interpolation
   */
  predict(
    input: PredictionInput,
    historicalDatasets: SelectedHistoricalDataset[],
  ): PredictionOutput {
    if (!historicalDatasets || historicalDatasets.length === 0) {
      return {
        status: 'UNAVAILABLE',
        unavailableReason: 'INSUFFICIENT_HISTORICAL_DATA',
        inputScore: input.score,
        normalizedScore: input.score,
        historicalExamCount: 0,
        datasetSize: 0,
        modelCode: this.MODEL_CODE,
        modelVersion: this.MODEL_VERSION,
        configVersion: 1,
        datasetVersion: 1,
      };
    }

    const estimates: {
      datasetId: string;
      examName: string;
      weight: number;
      estimatedRank: number;
      normalizedScore: number;
    }[] = [];

    let totalCandidatePool = 0;

    for (const dataset of historicalDatasets) {
      totalCandidatePool += dataset.totalCandidates;
      const ranges = dataset.scoreRanges;
      if (!ranges || ranges.length === 0) continue;

      // 1. Normalize current score to historical exam totalMarks if needed
      const normalizedScore =
        input.totalMarks > 0 && dataset.totalMarks > 0
          ? Math.round(((input.score * dataset.totalMarks) / input.totalMarks) * 100) / 100
          : input.score;

      // 2. Perform piecewise linear interpolation
      const estimatedRank = this.interpolateRank(normalizedScore, ranges, dataset.totalCandidates);
      if (estimatedRank !== null) {
        estimates.push({
          datasetId: dataset.historicalExamId,
          examName: dataset.examName,
          weight: dataset.weight,
          estimatedRank,
          normalizedScore,
        });
      }
    }

    if (estimates.length === 0) {
      return {
        status: 'UNAVAILABLE',
        unavailableReason: 'INSUFFICIENT_SCORE_COVERAGE',
        inputScore: input.score,
        normalizedScore: input.score,
        historicalExamCount: historicalDatasets.length,
        datasetSize: totalCandidatePool,
        modelCode: this.MODEL_CODE,
        modelVersion: this.MODEL_VERSION,
        configVersion: 1,
        datasetVersion: 1,
      };
    }

    // 3. Compute weighted average rank
    let weightedRankSum = 0;
    let totalWeight = 0;
    const rankValues: number[] = [];

    for (const est of estimates) {
      weightedRankSum += est.estimatedRank * est.weight;
      totalWeight += est.weight;
      rankValues.push(est.estimatedRank);
    }

    const predictedRank =
      totalWeight > 0 ? Math.round(weightedRankSum / totalWeight) : Math.round(rankValues[0]);

    // 4. Derive dynamic prediction range [min, max]
    const minEstimated = Math.min(...rankValues);
    const maxEstimated = Math.max(...rankValues);
    const spread = Math.max(3, Math.ceil(predictedRank * 0.05));

    const predictedRankMin = Math.max(1, Math.min(minEstimated, predictedRank - spread));
    const predictedRankMax = Math.max(predictedRankMin + 1, Math.max(maxEstimated, predictedRank + spread));

    // 5. Confidence Score (0 - 100)
    let confidenceScore = 50; // base for 1 dataset
    if (estimates.length >= 3) confidenceScore += 25;
    else if (estimates.length >= 2) confidenceScore += 15;

    if (totalCandidatePool >= 10000) confidenceScore += 15;
    else if (totalCandidatePool >= 2000) confidenceScore += 10;

    // Variance penalty: if estimates differ wildly, lower confidence
    const variance = maxEstimated - minEstimated;
    if (variance > predictedRank * 0.3) confidenceScore -= 20;

    confidenceScore = Math.max(0, Math.min(100, confidenceScore));
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
      confidenceScore >= 80 ? 'HIGH' : confidenceScore >= 50 ? 'MEDIUM' : 'LOW';

    // Estimated percentile
    const avgTotal = totalCandidatePool / estimates.length;
    const percentileEstimate =
      avgTotal > 0
        ? Math.round(Math.max(0, Math.min(100, ((avgTotal - (predictedRank - 1)) / avgTotal) * 100)) * 100) / 100
        : 95.0;

    return {
      status: 'COMPLETED',
      inputScore: input.score,
      normalizedScore: estimates[0].normalizedScore,
      predictedRank,
      predictedRankMin,
      predictedRankMax,
      confidence,
      confidenceScore,
      percentileEstimate,
      historicalExamCount: estimates.length,
      datasetSize: totalCandidatePool,
      modelCode: this.MODEL_CODE,
      modelVersion: this.MODEL_VERSION,
      configVersion: 1,
      datasetVersion: 1,
      explanation: {
        method: 'PIECEWISE_LINEAR_HISTORICAL_INTERPOLATION',
        historicalDatasetsUsed: estimates.map((e) => ({
          exam: e.examName,
          weight: e.weight,
          estimatedRank: e.estimatedRank,
        })),
        scoreRangeVariance: variance,
        disclaimer:
          'Predicted rank is a statistical projection derived from verified historical exam score-to-rank distributions. Not an official rank.',
      },
    };
  }

  /**
   * Helper: Piecewise linear interpolation between score range buckets
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
  ): number | null {
    // Sort ranges ascending by score
    const sorted = [...ranges].sort((a, b) => a.representativeScore - b.representativeScore);

    const minObserved = sorted[0].minScore;
    const maxObserved = sorted[sorted.length - 1].maxScore;

    // Check bounds
    if (score < minObserved) {
      return totalCandidates; // Lowest score -> lowest rank
    }
    if (score >= maxObserved) {
      return 1; // Top score -> rank 1
    }

    // Find direct range or surrounding ranges
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];

      // Exact match with range bucket
      if (score >= curr.minScore && score <= curr.maxScore) {
        if (curr.maxScore === curr.minScore) return curr.minRank;
        const bucketRatio = (score - curr.minScore) / (curr.maxScore - curr.minScore);
        // Note: higher score within bucket gives lower (better) rank
        const rank = curr.maxRank - bucketRatio * (curr.maxRank - curr.minRank);
        return Math.round(rank);
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
          const rank = r1 + ratio * (r2 - r1);
          return Math.max(1, Math.min(totalCandidates, Math.round(rank)));
        }
      }
    }

    return null;
  }
}
