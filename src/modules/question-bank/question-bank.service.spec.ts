import { Test, TestingModule } from '@nestjs/testing';
import { QuestionBankService } from './question-bank.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QuestionStatus } from './enums/question-status.enum';
import { QuestionTypeEnum } from './enums/question-type.enum';
import { QuestionDifficultyEnum } from './enums/question-difficulty.enum';

describe('QuestionBankService', () => {
  let service: QuestionBankService;
  let prisma: any;

  const mockPrismaService = {
    subject: { findUnique: jest.fn(), findMany: jest.fn() },
    chapter: { findUnique: jest.fn() },
    topic: { findUnique: jest.fn() },
    subTopic: { findUnique: jest.fn() },
    question: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
    questionTranslation: { createMany: jest.fn(), deleteMany: jest.fn() },
    questionOption: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    questionOptionTranslation: { createMany: jest.fn(), deleteMany: jest.fn() },
    questionAnswer: { create: jest.fn(), upsert: jest.fn() },
    questionExplanation: { create: jest.fn(), upsert: jest.fn() },
    questionReviewHistory: { create: jest.fn(), findMany: jest.fn() },
    examQuestion: { count: jest.fn() },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionBankService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<QuestionBankService>(QuestionBankService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ═════════════════════════════════════════════════════════════════
  // 1. Hierarchy Validation Tests
  // ═════════════════════════════════════════════════════════════════
  describe('validateHierarchy', () => {
    it('should succeed when hierarchy is valid', async () => {
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Physics',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Mechanics',
        subjectId: 'sub-1',
        isActive: true,
      });
      prisma.topic.findUnique.mockResolvedValue({
        id: 'top-1',
        name: 'Kinematics',
        chapterId: 'chap-1',
      });
      prisma.subTopic.findUnique.mockResolvedValue({
        id: 'subtop-1',
        name: 'Vectors',
        topicId: 'top-1',
      });

      await expect(
        service.validateHierarchy('sub-1', 'chap-1', 'top-1', 'subtop-1'),
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException if subject does not exist', async () => {
      prisma.subject.findUnique.mockResolvedValue(null);
      await expect(
        service.validateHierarchy('sub-invalid', 'chap-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if chapter does not belong to subject', async () => {
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Physics',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Mechanics',
        subjectId: 'sub-other',
      });

      await expect(
        service.validateHierarchy('sub-1', 'chap-1'),
      ).rejects.toThrow(/does not belong to the selected Subject/);
    });

    it('should throw BadRequestException if topic does not belong to chapter', async () => {
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Physics',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Mechanics',
        subjectId: 'sub-1',
        isActive: true,
      });
      prisma.topic.findUnique.mockResolvedValue({
        id: 'top-1',
        name: 'Optics',
        chapterId: 'chap-other',
      });

      await expect(
        service.validateHierarchy('sub-1', 'chap-1', 'top-1'),
      ).rejects.toThrow(/does not belong to the selected Chapter/);
    });

    it('should throw BadRequestException if subTopic does not belong to topic', async () => {
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Physics',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Mechanics',
        subjectId: 'sub-1',
        isActive: true,
      });
      prisma.topic.findUnique.mockResolvedValue({
        id: 'top-1',
        name: 'Kinematics',
        chapterId: 'chap-1',
      });
      prisma.subTopic.findUnique.mockResolvedValue({
        id: 'subtop-1',
        name: 'Lenses',
        topicId: 'top-other',
      });

      await expect(
        service.validateHierarchy('sub-1', 'chap-1', 'top-1', 'subtop-1'),
      ).rejects.toThrow(/does not belong to the selected Topic/);
    });

    it('should throw BadRequestException if subTopic is provided without topic', async () => {
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Physics',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Mechanics',
        subjectId: 'sub-1',
        isActive: true,
      });

      await expect(
        service.validateHierarchy('sub-1', 'chap-1', undefined, 'subtop-1'),
      ).rejects.toThrow(
        /Cannot assign a SubTopic without selecting a parent Topic/,
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 2. Question Type & Answer Validation Tests
  // ═════════════════════════════════════════════════════════════════
  describe('validateQuestionTypeAndAnswer', () => {
    it('should validate SINGLE_CORRECT with exactly 1 correct option', () => {
      const options = [
        { optionKey: 'A', optionLabel: 'Option A', isCorrect: true },
        { optionKey: 'B', optionLabel: 'Option B', isCorrect: false },
      ];
      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.SINGLE_CORRECT,
          options as any,
        ),
      ).not.toThrow();
    });

    it('should throw for SINGLE_CORRECT with multiple correct options', () => {
      const options = [
        { optionKey: 'A', optionLabel: 'Option A', isCorrect: true },
        { optionKey: 'B', optionLabel: 'Option B', isCorrect: true },
      ];
      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.SINGLE_CORRECT,
          options as any,
        ),
      ).toThrow(BadRequestException);
    });

    it('should validate MULTIPLE_CORRECT with >= 1 correct options', () => {
      const options = [
        { optionKey: 'A', optionLabel: 'Option A', isCorrect: true },
        { optionKey: 'B', optionLabel: 'Option B', isCorrect: true },
      ];
      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.MULTIPLE_CORRECT,
          options as any,
        ),
      ).not.toThrow();
    });

    it('should validate NUMERICAL with numeric answer or range', () => {
      expect(() =>
        service.validateQuestionTypeAndAnswer(QuestionTypeEnum.NUMERICAL, [], {
          numericalAnswer: 42,
        }),
      ).not.toThrow();

      expect(() =>
        service.validateQuestionTypeAndAnswer(QuestionTypeEnum.NUMERICAL, [], {
          numericalRangeStart: 40,
          numericalRangeEnd: 45,
        }),
      ).not.toThrow();

      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.NUMERICAL,
          [],
          {},
        ),
      ).toThrow(BadRequestException);
    });

    it('should validate ASSERTION_REASON requires assertion and reason text', () => {
      const options = [
        { optionKey: 'A', isCorrect: true },
        { optionKey: 'B', isCorrect: false },
      ];
      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.ASSERTION_REASON,
          options as any,
          undefined,
          undefined,
          'Assertion text',
          'Reason text',
        ),
      ).not.toThrow();

      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.ASSERTION_REASON,
          options as any,
          undefined,
          undefined,
          '',
          'Reason text',
        ),
      ).toThrow(BadRequestException);
    });

    it('should validate CASE_BASED requires passage text', () => {
      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.CASE_BASED,
          [],
          undefined,
          'Passage description',
        ),
      ).not.toThrow();

      expect(() =>
        service.validateQuestionTypeAndAnswer(
          QuestionTypeEnum.CASE_BASED,
          [],
          undefined,
          '',
        ),
      ).toThrow(BadRequestException);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 3. Question Creation Tests
  // ═════════════════════════════════════════════════════════════════
  describe('createQuestion', () => {
    it('should successfully create a question in DRAFT status', async () => {
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Chemistry',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Organic',
        subjectId: 'sub-1',
        isActive: true,
      });
      prisma.question.create.mockResolvedValue({
        id: 'q-101',
        status: QuestionStatus.DRAFT,
        version: 1,
      });
      prisma.questionOption.create.mockResolvedValue({
        id: 'opt-1',
        optionKey: 'A',
      });
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-101',
        status: QuestionStatus.DRAFT,
        version: 1,
        subject: { id: 'sub-1', name: 'Chemistry' },
      });

      const dto = {
        subjectId: 'sub-1',
        chapterId: 'chap-1',
        defaultLanguageId: 'lang-1',
        type: QuestionTypeEnum.SINGLE_CORRECT,
        difficultyLevel: QuestionDifficultyEnum.EASY,
        translations: [
          { languageId: 'lang-1', questionText: 'What is Benzene?' },
        ],
        options: [
          { optionKey: 'A', optionLabel: 'C6H6', isCorrect: true },
          { optionKey: 'B', optionLabel: 'CH4', isCorrect: false },
        ],
      };

      const result = await service.createQuestion(dto, 'user-123');

      expect(prisma.question.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: QuestionStatus.DRAFT,
            version: 1,
            createdById: 'user-123',
          }),
        }),
      );
      expect(prisma.questionReviewHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATED',
            toStatus: QuestionStatus.DRAFT,
          }),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 4. Lifecycle Workflow Tests (Submit -> Review -> Approve / Reject)
  // ═════════════════════════════════════════════════════════════════
  describe('Workflow Transitions', () => {
    it('submitQuestion: should transition DRAFT to SUBMITTED', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.DRAFT,
      });

      await service.submitQuestion('q-1', 'admin-1', 'Ready for review');

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: expect.objectContaining({
          status: QuestionStatus.SUBMITTED,
          submittedById: 'admin-1',
        }),
      });
      expect(prisma.questionReviewHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUBMITTED',
            toStatus: QuestionStatus.SUBMITTED,
          }),
        }),
      );
    });

    it('submitQuestion: should throw if question is already APPROVED', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.APPROVED,
      });

      await expect(service.submitQuestion('q-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('startReview: should transition SUBMITTED to UNDER_REVIEW', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.SUBMITTED,
      });

      await service.startReview('q-1', 'super-admin-1');

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: expect.objectContaining({
          status: QuestionStatus.UNDER_REVIEW,
          reviewedById: 'super-admin-1',
        }),
      });
    });

    it('approveQuestion: should transition UNDER_REVIEW to APPROVED', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.UNDER_REVIEW,
        createdById: 'admin-creator',
      });

      await service.approveQuestion(
        'q-1',
        'super-admin-1',
        ['SUPER_ADMIN'],
        'LGTM',
      );

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: expect.objectContaining({
          status: QuestionStatus.APPROVED,
          approvedById: 'super-admin-1',
        }),
      });
    });

    it('approveQuestion: should prevent admin creator from self-approving', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.UNDER_REVIEW,
        createdById: 'admin-1',
      });

      await expect(
        service.approveQuestion('q-1', 'admin-1', ['ADMIN']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejectQuestion: should require reason and transition to REJECTED', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.UNDER_REVIEW,
      });

      await service.rejectQuestion(
        'q-1',
        'super-admin-1',
        'Options are ambiguous',
      );

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: expect.objectContaining({
          status: QuestionStatus.REJECTED,
          rejectionReason: 'Options are ambiguous',
        }),
      });
    });

    it('rejectQuestion: should throw if reason is empty', async () => {
      await expect(
        service.rejectQuestion('q-1', 'super-admin-1', '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('archiveQuestion: should transition APPROVED to ARCHIVED and set isActive to false', async () => {
      prisma.question.findUnique.mockResolvedValue({
        id: 'q-1',
        status: QuestionStatus.APPROVED,
      });

      await service.archiveQuestion(
        'q-1',
        'super-admin-1',
        'Curriculum updated',
      );

      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: expect.objectContaining({
          status: QuestionStatus.ARCHIVED,
          isActive: false,
        }),
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 5. Versioning on Approved Question Edit
  // ═════════════════════════════════════════════════════════════════
  describe('updateQuestion Versioning', () => {
    it('should spawn version 2 in DRAFT status when updating an APPROVED question', async () => {
      const approvedParent = {
        id: 'q-v1',
        status: QuestionStatus.APPROVED,
        version: 1,
        subjectId: 'sub-1',
        chapterId: 'chap-1',
        defaultLanguageId: 'lang-1',
        type: QuestionTypeEnum.SINGLE_CORRECT,
        difficultyLevel: QuestionDifficultyEnum.MEDIUM,
        marks: 4,
        negativeMarks: 1,
        translations: [{ languageId: 'lang-1', questionText: 'Original text' }],
        options: [
          { optionKey: 'A', optionLabel: 'A', isCorrect: true },
          { optionKey: 'B', optionLabel: 'B', isCorrect: false },
        ],
      };

      prisma.question.findUnique.mockResolvedValue(approvedParent);
      prisma.subject.findUnique.mockResolvedValue({
        id: 'sub-1',
        name: 'Physics',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'chap-1',
        name: 'Motion',
        subjectId: 'sub-1',
        isActive: true,
      });
      prisma.question.create.mockResolvedValue({
        id: 'q-v2',
        version: 2,
        status: QuestionStatus.DRAFT,
        parentQuestionId: 'q-v1',
      });

      const updateDto = {
        translations: [
          { languageId: 'lang-1', questionText: 'Updated text for v2' },
        ],
      };

      await service.updateQuestion('q-v1', updateDto, 'admin-2', ['ADMIN']);

      expect(prisma.question.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
            status: QuestionStatus.DRAFT,
            parentQuestionId: 'q-v1',
            createdById: 'admin-2',
          }),
        }),
      );
      expect(prisma.questionReviewHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'VERSION_CREATED',
            fromStatus: QuestionStatus.APPROVED,
            toStatus: QuestionStatus.DRAFT,
          }),
        }),
      );
    });
  });
});
