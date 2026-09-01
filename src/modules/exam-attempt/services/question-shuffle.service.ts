import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * High-performance deterministic PRNG using 32-bit MurmurHash3 + Mulberry32.
 * Guaranteed to produce identical sequence given the exact same seed string.
 */
function createDeterministicRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  let state = (h ^ (h >>> 16)) >>> 0;

  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded in-place / copy Fisher-Yates shuffle.
 */
function seededShuffle<T>(array: T[], prng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

@Injectable()
export class QuestionShuffleService {
  /**
   * Generates a cryptographically secure 128-bit server random seed for the attempt
   */
  generateAttemptSeed(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Shuffles questions deterministically.
   * By default, preserves section boundaries and order, while shuffling questions within each section.
   */
  shuffleQuestions<
    T extends { id: string; sectionId?: string | null; section?: any },
  >(
    questions: T[],
    attemptSeed: string,
    randomizeWithinSections: boolean = true,
  ): T[] {
    if (!questions || questions.length <= 1) return [...questions];

    if (!randomizeWithinSections) {
      // Global shuffle across all sections
      const prng = createDeterministicRandom(`attempt_${attemptSeed}_questions_all`);
      return seededShuffle(questions, prng);
    }

    // Group questions by section/subject in original section appearance order
    const sectionMap = new Map<string, T[]>();
    for (const q of questions) {
      const secKey = q.sectionId || q.section?.id || 'default_section';
      if (!sectionMap.has(secKey)) {
        sectionMap.set(secKey, []);
      }
      sectionMap.get(secKey)!.push(q);
    }

    const shuffledResult: T[] = [];
    for (const [secKey, secQuestions] of sectionMap.entries()) {
      const prng = createDeterministicRandom(
        `attempt_${attemptSeed}_sec_${secKey}`,
      );
      const shuffledSection = seededShuffle(secQuestions, prng);
      shuffledResult.push(...shuffledSection);
    }

    return shuffledResult;
  }

  /**
   * Shuffles options deterministically for a specific question.
   */
  shuffleOptions<T extends { id: string }>(
    options: T[],
    attemptSeed: string,
    questionId: string,
  ): T[] {
    if (!options || options.length <= 1) return [...options];

    const prng = createDeterministicRandom(
      `attempt_${attemptSeed}_opt_${questionId}`,
    );
    return seededShuffle(options, prng);
  }
}
