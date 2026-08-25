import { Injectable } from '@nestjs/common';
import { CandidateRankInput } from '../interfaces/rank-engine.interface';

@Injectable()
export class TieBreakService {
  /**
   * Sort candidates according to configurable tie-break rules:
   * 1. score (DESC)
   * 2. accuracy (DESC)
   * 3. negativeMarksLost (ASC)
   * 4. timeUsedSeconds (ASC)
   * 5. correctCount (DESC)
   * 6. wrongCount (ASC)
   * 7. studentId (ASC) - fallback for deterministic ordering
   */
  sortCandidates(candidates: CandidateRankInput[]): CandidateRankInput[] {
    return [...candidates].sort((a, b) => {
      // 1. Obtained score (DESC)
      if (b.score !== a.score) return b.score - a.score;

      // 2. Accuracy (DESC)
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;

      // 3. Negative marks lost (ASC - lower penalty is better)
      if (a.negativeMarksLost !== b.negativeMarksLost) return a.negativeMarksLost - b.negativeMarksLost;

      // 4. Time used (ASC - faster completion is better)
      if (a.timeUsedSeconds !== b.timeUsedSeconds) return a.timeUsedSeconds - b.timeUsedSeconds;

      // 5. Correct count (DESC)
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;

      // 6. Wrong count (ASC)
      if (a.wrongCount !== b.wrongCount) return a.wrongCount - b.wrongCount;

      // 7. Deterministic candidate ID fallback
      return a.studentId.localeCompare(b.studentId);
    });
  }

  /**
   * Check if two candidates are strictly tied on all primary academic metrics
   */
  areTied(a: CandidateRankInput, b: CandidateRankInput): boolean {
    return (
      a.score === b.score &&
      a.accuracy === b.accuracy &&
      a.negativeMarksLost === b.negativeMarksLost &&
      a.timeUsedSeconds === b.timeUsedSeconds &&
      a.correctCount === b.correctCount &&
      a.wrongCount === b.wrongCount
    );
  }

  /**
   * Assign ranks according to chosen rank mode (COMPETITION: 1, 1, 3 | DENSE: 1, 1, 2 | ORDINAL: 1, 2, 3)
   */
  assignRanks(
    sortedCandidates: CandidateRankInput[],
    mode: 'COMPETITION' | 'DENSE' | 'ORDINAL' = 'COMPETITION',
  ): { candidate: CandidateRankInput; rank: number }[] {
    const results: { candidate: CandidateRankInput; rank: number }[] = [];
    if (sortedCandidates.length === 0) return results;

    let currentRank = 1;
    let denseRank = 1;

    for (let i = 0; i < sortedCandidates.length; i++) {
      const current = sortedCandidates[i];

      if (i === 0) {
        results.push({ candidate: current, rank: 1 });
        continue;
      }

      const prev = sortedCandidates[i - 1];
      const isTie = this.areTied(current, prev);

      if (isTie) {
        if (mode === 'COMPETITION') {
          results.push({ candidate: current, rank: results[i - 1].rank });
        } else if (mode === 'DENSE') {
          results.push({ candidate: current, rank: denseRank });
        } else {
          // ORDINAL
          currentRank++;
          results.push({ candidate: current, rank: currentRank });
        }
      } else {
        if (mode === 'COMPETITION') {
          currentRank = i + 1;
          results.push({ candidate: current, rank: currentRank });
        } else if (mode === 'DENSE') {
          denseRank++;
          results.push({ candidate: current, rank: denseRank });
        } else {
          // ORDINAL
          currentRank = i + 1;
          results.push({ candidate: current, rank: currentRank });
        }
      }
    }

    return results;
  }
}
