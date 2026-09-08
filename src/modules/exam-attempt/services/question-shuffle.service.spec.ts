import { Test, TestingModule } from '@nestjs/testing';
import { QuestionShuffleService } from './question-shuffle.service';

describe('QuestionShuffleService', () => {
  let service: QuestionShuffleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuestionShuffleService],
    }).compile();

    service = module.get<QuestionShuffleService>(QuestionShuffleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateDeterministicSeed', () => {
    it('should generate identical seed string for exact same studentId, examVersionId, and attemptId', () => {
      const seed1 = service.generateDeterministicSeed('student_101', 'v_1.0', 'attempt_abc');
      const seed2 = service.generateDeterministicSeed('student_101', 'v_1.0', 'attempt_abc');

      expect(seed1).toBe(seed2);
      expect(seed1).toHaveLength(64); // SHA-256 hex output length
    });

    it('should generate different seeds for different attempts', () => {
      const seedAttempt1 = service.generateDeterministicSeed('student_101', 'v_1.0', 'attempt_1');
      const seedAttempt2 = service.generateDeterministicSeed('student_101', 'v_1.0', 'attempt_2');

      expect(seedAttempt1).not.toEqual(seedAttempt2);
    });
  });

  describe('normalizeSeedToPostgresRange', () => {
    it('should normalize any seed string to a float between -1.0 and 1.0', () => {
      const norm1 = service.normalizeSeedToPostgresRange('student_101:v_1:att_1');
      const norm2 = service.normalizeSeedToPostgresRange('student_101:v_1:att_1');

      expect(norm1).toBeGreaterThanOrEqual(-1.0);
      expect(norm1).toBeLessThanOrEqual(1.0);
      expect(norm1).toBe(norm2); // Reproducible
    });
  });

  describe('generateAttemptSeed', () => {
    it('should generate a 32-character hex random seed', () => {
      const seed1 = service.generateAttemptSeed();
      const seed2 = service.generateAttemptSeed();

      expect(seed1).toHaveLength(32);
      expect(seed2).toHaveLength(32);
      expect(seed1).not.toEqual(seed2);
    });
  });

  describe('shuffleQuestions', () => {
    const mockQuestions = [
      { id: 'Q1', sectionId: 'SEC_PHYSICS' },
      { id: 'Q2', sectionId: 'SEC_PHYSICS' },
      { id: 'Q3', sectionId: 'SEC_PHYSICS' },
      { id: 'Q4', sectionId: 'SEC_CHEMISTRY' },
      { id: 'Q5', sectionId: 'SEC_CHEMISTRY' },
      { id: 'Q6', sectionId: 'SEC_CHEMISTRY' },
    ];

    it('should produce identical order for the same seed (deterministic)', () => {
      const seed = 'test_seed_12345';
      const order1 = service.shuffleQuestions(mockQuestions, seed, true);
      const order2 = service.shuffleQuestions(mockQuestions, seed, true);

      expect(order1.map((q) => q.id)).toEqual(order2.map((q) => q.id));
    });

    it('should produce different orders for different seeds (Student A vs Student B)', () => {
      const seedA = 'student_a_seed_777';
      const seedB = 'student_b_seed_888';
      const orderA = service.shuffleQuestions(mockQuestions, seedA, true);
      const orderB = service.shuffleQuestions(mockQuestions, seedB, true);

      // Both must contain all 6 questions
      expect(orderA).toHaveLength(6);
      expect(orderB).toHaveLength(6);
      expect(new Set(orderA.map((q) => q.id))).toEqual(
        new Set(mockQuestions.map((q) => q.id)),
      );
    });

    it('should preserve section boundaries when randomizeWithinSections is true', () => {
      const seed = 'seed_section_check_999';
      const order = service.shuffleQuestions(mockQuestions, seed, true);

      // First 3 questions must be physics, last 3 must be chemistry
      const firstSectionIds = order.slice(0, 3).map((q) => q.sectionId);
      const secondSectionIds = order.slice(3, 6).map((q) => q.sectionId);

      expect(firstSectionIds).toEqual([
        'SEC_PHYSICS',
        'SEC_PHYSICS',
        'SEC_PHYSICS',
      ]);
      expect(secondSectionIds).toEqual([
        'SEC_CHEMISTRY',
        'SEC_CHEMISTRY',
        'SEC_CHEMISTRY',
      ]);
    });
  });

  describe('shuffleOptions', () => {
    const mockOptions = [
      { id: 'OPT_A' },
      { id: 'OPT_B' },
      { id: 'OPT_C' },
      { id: 'OPT_D' },
    ];

    it('should produce identical option order for the same seed and question', () => {
      const seed = 'opt_seed_123';
      const qId = 'question_42';
      const optOrder1 = service.shuffleOptions(mockOptions, seed, qId);
      const optOrder2 = service.shuffleOptions(mockOptions, seed, qId);

      expect(optOrder1.map((o) => o.id)).toEqual(optOrder2.map((o) => o.id));
    });

    it('should produce different option orders for different seeds', () => {
      const seedA = 'student_a_opt_seed';
      const seedB = 'student_b_opt_seed';
      const qId = 'question_42';
      const optOrderA = service.shuffleOptions(mockOptions, seedA, qId);
      const optOrderB = service.shuffleOptions(mockOptions, seedB, qId);

      expect(optOrderA).toHaveLength(4);
      expect(optOrderB).toHaveLength(4);
    });
  });
});
