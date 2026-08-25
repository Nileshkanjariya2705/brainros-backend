import { Injectable } from '@nestjs/common';

@Injectable()
export class PredictionService {
  private readonly MODEL_VERSION = 'v1.0.0';

  /**
   * Compute conservative statistical predicted rank range
   */
  predictRankRange(params: {
    actualRank: number;
    totalCandidates: number;
    score: number;
    maxScore: number;
    percentile: number;
  }): {
    min: number;
    max: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    modelVersion: string;
  } {
    const { actualRank, totalCandidates, score, maxScore, percentile } = params;

    if (totalCandidates <= 0 || maxScore <= 0) {
      return {
        min: 1,
        max: 1,
        confidence: 'LOW',
        modelVersion: this.MODEL_VERSION,
      };
    }

    // Variance buffer based on candidate population size
    const variancePercent = totalCandidates > 500 ? 0.05 : totalCandidates > 50 ? 0.1 : 0.15;
    const spread = Math.max(2, Math.round(actualRank * variancePercent));

    const min = Math.max(1, actualRank - Math.floor(spread / 2));
    const max = Math.min(totalCandidates, actualRank + Math.ceil(spread / 2));

    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
      totalCandidates >= 100 ? 'HIGH' : totalCandidates >= 20 ? 'MEDIUM' : 'LOW';

    return {
      min,
      max,
      confidence,
      modelVersion: this.MODEL_VERSION,
    };
  }
}
