import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamRandomizationService } from './services/exam-randomization.service';
import { BlueprintValidationService } from './services/blueprint-validation.service';
import { QuestionPoolService } from './services/question-pool.service';
import { ExamSnapshotService } from './services/exam-snapshot.service';
import { ExamGenerationService } from './services/exam-generation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Exam Generator & Snapshot Engine', () => {
  let randomizationService: ExamRandomizationService;
  let validationService: BlueprintValidationService;
  let poolService: QuestionPoolService;
  let snapshotService: ExamSnapshotService;
  let generationService: ExamGenerationService;

  const mockPrismaService = {
    examBlueprint: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    question: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    subject: {
      findUnique: jest.fn(),
    },
    examVersion: {
      aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
      create: jest.fn().mockResolvedValue({
        id: 'version-1',
        examId: 'exam-1',
        versionNumber: 1,
        status: 'GENERATED',
      }),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    examVersionQuestion: {
      create: jest.fn().mockResolvedValue({ id: 'evq-1' }),
      findMany: jest.fn(),
    },
    examVersionOption: {
      create: jest.fn().mockResolvedValue({ id: 'evopt-1' }),
    },
    examVersionTranslation: {
      create: jest.fn().mockResolvedValue({ id: 'evtr-1' }),
    },
    examVersionOptionTranslation: {
      create: jest.fn().mockResolvedValue({ id: 'evoptr-1' }),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamRandomizationService,
        BlueprintValidationService,
        QuestionPoolService,
        ExamSnapshotService,
        ExamGenerationService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    randomizationService = module.get<ExamRandomizationService>(
      ExamRandomizationService,
    );
    validationService = module.get<BlueprintValidationService>(
      BlueprintValidationService,
    );
    poolService = module.get<QuestionPoolService>(QuestionPoolService);
    snapshotService = module.get<ExamSnapshotService>(ExamSnapshotService);
    generationService = module.get<ExamGenerationService>(
      ExamGenerationService,
    );

    jest.clearAllMocks();
  });

  describe('1. Blueprint Validation & Distribution Resolution', () => {
    it('should resolve exact subject counts matching totalQuestions (Physics=45, Chemistry=45, Biology=90 -> 180)', () => {
      const rules = [
        { subjectId: 'subj-phy', selectionCount: 45 },
        { subjectId: 'subj-chem', selectionCount: 45 },
        { subjectId: 'subj-bio', selectionCount: 90 },
      ];

      const resolved = validationService.resolveBlueprintRuleCounts(180, rules);
      expect(resolved).toHaveLength(3);
      expect(resolved.reduce((sum, r) => sum + r.requiredCount, 0)).toBe(180);
      expect(resolved[0].requiredCount).toBe(45);
      expect(resolved[1].requiredCount).toBe(45);
      expect(resolved[2].requiredCount).toBe(90);
    });

    it('should resolve percentage rules with exact integer apportionment (30% Easy, 50% Med, 20% Hard for 180 questions -> 54, 90, 36)', () => {
      const rules = [
        { difficultyLevel: 'EASY', selectionPercentage: 30 },
        { difficultyLevel: 'MEDIUM', selectionPercentage: 50 },
        { difficultyLevel: 'HARD', selectionPercentage: 20 },
      ];

      const resolved = validationService.resolveBlueprintRuleCounts(
        180,
        rules as any,
      );
      expect(resolved).toHaveLength(3);
      expect(resolved.reduce((sum, r) => sum + r.requiredCount, 0)).toBe(180);
      expect(
        resolved.find((r) => r.difficultyLevel === 'EASY')?.requiredCount,
      ).toBe(54);
      expect(
        resolved.find((r) => r.difficultyLevel === 'MEDIUM')?.requiredCount,
      ).toBe(90);
      expect(
        resolved.find((r) => r.difficultyLevel === 'HARD')?.requiredCount,
      ).toBe(36);
    });

    it('should reject blueprint if sum of fixed counts exceeds totalQuestions', () => {
      const rules = [
        { subjectId: 'subj-1', selectionCount: 60 },
        { subjectId: 'subj-2', selectionCount: 50 },
      ];

      expect(() =>
        validationService.resolveBlueprintRuleCounts(100, rules as any),
      ).toThrow(BadRequestException);
    });

    it('should reject overlapping duplicate rules with identical criteria', () => {
      const rules = [
        { subjectId: 'subj-1', difficultyLevel: 'EASY', selectionCount: 20 },
        { subjectId: 'subj-1', difficultyLevel: 'EASY', selectionCount: 30 },
      ];

      expect(() =>
        validationService.resolveBlueprintRuleCounts(50, rules as any),
      ).toThrow(BadRequestException);
    });
  });

  describe('2. Deterministic Seed-Based Randomization & Answer Integrity', () => {
    it('should produce identical shuffle ordering when given the exact same seed', () => {
      const items = [
        'Q1',
        'Q2',
        'Q3',
        'Q4',
        'Q5',
        'Q6',
        'Q7',
        'Q8',
        'Q9',
        'Q10',
      ];
      const seed = 'test_audit_seed_12345';

      const shuffle1 = randomizationService.shuffleArray(items, seed);
      const shuffle2 = randomizationService.shuffleArray(items, seed);

      expect(shuffle1).toEqual(shuffle2);
    });

    it('should randomize option display order while preserving correct option identity', () => {
      const options = [
        { id: 'opt-1', isCorrect: false, label: 'Option A' },
        { id: 'opt-2', isCorrect: true, label: 'Option B' },
        { id: 'opt-3', isCorrect: false, label: 'Option C' },
        { id: 'opt-4', isCorrect: false, label: 'Option D' },
      ];

      const shuffledOpts = randomizationService.shuffleOptions(
        options,
        'seed_opts_999',
      );

      expect(shuffledOpts).toHaveLength(4);
      const correctOpt = shuffledOpts.find((o) => o.isCorrect);
      expect(correctOpt).toBeDefined();
      expect(correctOpt?.id).toBe('opt-2'); // Correct option preserved regardless of displayOrder
    });
  });

  describe('3. Pool Shortage Detection', () => {
    it('should fail with descriptive error if question bank has insufficient eligible questions for a rule', async () => {
      mockPrismaService.question.findMany.mockResolvedValueOnce([
        { id: 'q-1', status: 'APPROVED', isActive: true },
        { id: 'q-2', status: 'APPROVED', isActive: true },
      ]);

      const requirements = [
        {
          subjectId: 'subj-phy',
          difficultyLevel: 'HARD',
          requiredCount: 10,
        },
      ];

      await expect(
        poolService.selectQuestionsForBlueprint(requirements, 'seed_123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Immutable Snapshot Isolation (Live Question Bank Mutation Test)', () => {
    it('should isolate generated ExamVersion snapshot from later live Question Bank text updates', async () => {
      // Step 1: Mock Question Bank record at generation time
      const originalLiveQuestion = {
        id: 'q-101',
        version: 1,
        type: 'SINGLE_CORRECT',
        difficultyLevel: 'MEDIUM',
        passage: null,
        assertion: null,
        reason: null,
        marks: 4,
        negativeMarks: 1,
        translations: [
          {
            languageId: 'lang-en',
            questionText: 'What is photosynthesis?',
            explanation: 'Biological light process',
          },
        ],
        options: [
          {
            id: 'opt-501',
            optionKey: 'A',
            optionText: 'Plant food synthesis',
            isCorrect: true,
          },
          {
            id: 'opt-502',
            optionKey: 'B',
            optionText: 'Animal digestion',
            isCorrect: false,
          },
        ],
        answer: {
          answerType: 'SINGLE_CORRECT',
          correctOptionIds: ['opt-501'],
        },
      };

      const mockExam = {
        id: 'exam-1',
        totalQuestions: 1,
        totalMarks: 4,
        durationMinutes: 60,
        defaultMarksPerQuestion: 4,
        defaultNegativeMarks: 1,
        languages: [
          { language: { id: 'lang-en', code: 'en', name: 'English' } },
        ],
      };

      const mockCreatedVersion = {
        id: 'version-1',
        examId: 'exam-1',
        versionNumber: 1,
        status: 'GENERATED',
      };

      mockPrismaService.examVersion.create.mockResolvedValue(
        mockCreatedVersion,
      );

      // Step 2: Create snapshot
      await snapshotService.persistImmutableExamVersionSnapshot({
        exam: mockExam,
        blueprint: { id: 'bp-1', name: 'NEET Practice', version: 1 },
        selectedQuestions: [originalLiveQuestion],
        generationSeed: 'seed_immutable_test',
        generatedById: 'admin-1',
        languages: mockExam.languages,
      });

      // Verify ExamVersionQuestion was persisted with "What is photosynthesis?"
      expect(mockPrismaService.examVersionQuestion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceQuestionId: 'q-101',
            questionText: 'What is photosynthesis?',
          }),
        }),
      );

      // Step 3: Admin later modifies live Question in Question Bank to "What is photosynthesis in green plants?"
      originalLiveQuestion.translations[0].questionText =
        'What is photosynthesis in green plants?';

      // Step 4: When student takes the exam, fetch from ExamVersionQuestion snapshot table
      mockPrismaService.examVersion.findUnique.mockResolvedValue(
        mockCreatedVersion,
      );
      mockPrismaService.examVersionQuestion.findMany.mockResolvedValue([
        {
          id: 'evq-1',
          examVersionId: 'version-1',
          sourceQuestionId: 'q-101',
          sequenceNumber: 1,
          questionText: 'What is photosynthesis?', // Preserved snapshot text
          options: [
            {
              id: 'evopt-1',
              sourceOptionId: 'opt-501',
              displayOrder: 0,
              optionText: 'Plant food synthesis',
              isCorrect: true,
              translations: [],
            },
          ],
          translations: [],
        },
      ]);

      const examQuestions =
        await generationService.getExamVersionQuestions('version-1');
      expect(examQuestions[0].questionText).toBe('What is photosynthesis?');
      expect(examQuestions[0].options[0].sourceOptionId).toBe('opt-501');
      expect(examQuestions[0].options[0].isCorrect).toBe(true);
    });
  });

  describe('5. Concurrency Protection', () => {
    it('should reject simultaneous generation requests for the same blueprint', async () => {
      // Simulate slow generation
      mockPrismaService.examBlueprint.findUnique.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50)),
      );

      const p1 = generationService.generateExamVersion(
        'bp-dup-test',
        {},
        'user-1',
      );
      const p2 = generationService.generateExamVersion(
        'bp-dup-test',
        {},
        'user-2',
      );

      await expect(Promise.all([p1, p2])).rejects.toThrow(ConflictException);
    });
  });
});
