import { Injectable } from '@nestjs/common';

@Injectable()
export class PercentileService {
  /**
   * Calculate percentile with 4 decimal places precision.
   *
   * Formula:
   * percentile = ((totalCandidates - (rank - 1)) / totalCandidates) * 100
   *
   * Examples:
   * Rank 1 of 100 -> 100.00%
   * Rank 50 of 100 -> 51.00%
   * Rank 100 of 100 -> 1.00%
   */
  calculatePercentile(rank: number, totalCandidates: number, method: 'STANDARD' | 'FRACTIONAL' = 'STANDARD'): number {
    if (totalCandidates <= 0) return 0;
    if (totalCandidates === 1) return 100;

    let pct: number;
    if (method === 'FRACTIONAL') {
      pct = ((totalCandidates - rank) / totalCandidates) * 100;
    } else {
      pct = ((totalCandidates - (rank - 1)) / totalCandidates) * 100;
    }

    // Clamp between 0 and 100 and format to 4 decimal places
    const clamped = Math.max(0, Math.min(100, pct));
    return Math.round(clamped * 10000) / 10000;
  }
}
