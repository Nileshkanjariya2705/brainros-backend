import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class ExamRandomizationService {
  /**
   * Generates a secure random 16-character hexadecimal seed if none provided
   */
  generateSeed(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Mulberry32 Seeded Pseudo-Random Number Generator (PRNG)
   */
  private createSeededPRNG(seedStr: string): () => number {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }

    let a = h >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Deterministically shuffles an array using Fisher-Yates algorithm and seeded PRNG
   */
  shuffleArray<T>(items: T[], seed: string): T[] {
    const copy = [...items];
    const prng = this.createSeededPRNG(seed);

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }

  /**
   * Shuffles options for a question and assigns randomized 0-indexed displayOrder
   */
  shuffleOptions<T extends Record<string, any>>(options: T[], seed: string): (T & { displayOrder: number })[] {
    const shuffled = this.shuffleArray(options, seed);
    return shuffled.map((opt, idx) => ({
      ...opt,
      displayOrder: idx,
    }));
  }
}
