import { Test, TestingModule } from '@nestjs/testing';
import { LanguageService } from './services/language.service';
import { TranslationService } from './services/translation.service';
import { ExamLanguageService } from './services/exam-language.service';
import { ExamAttemptService } from '../exam-attempt/exam-attempt.service';
import { ExamService } from '../exam/exam.service';
import { ExamAccessService } from '../exam-scheduling/services/exam-access.service';
import { QuestionTimingService } from '../time-analysis/services/question-timing.service';
import { ResultService } from '../result/result.service';
import { PrismaService } from '../prisma/prisma.service';
import { SUPPORTED_NINE_REGIONAL_LANGUAGES } from './constants/supported-languages.constant';

describe('Regional Language Engine & Multilingual Exam Attempts', () => {
  let languageService: LanguageService;
  let translationService: TranslationService;
  let examLanguageService: ExamLanguageService;
  let examAttemptService: ExamAttemptService;
  let prismaService: any;

  const mockPrisma = {
    preferredLanguage: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    question: {
      findUnique: jest.fn(),
    },
    exam: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    examLanguage: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    questionTranslation: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    questionOptionTranslation: {
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    attempt: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    attemptStatus: {
      findUnique: jest.fn(),
    },
    answer: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    examQuestion: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb) =>
      typeof cb === 'function' ? cb(mockPrisma) : Promise.all(cb),
    ),
  };

  const mockExamService = {
    getExamQuestionsForAttempt: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageService,
        TranslationService,
        ExamLanguageService,
        ExamAttemptService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExamService, useValue: mockExamService },
        {
          provide: ExamAccessService,
          useValue: { validateStudentAccess: jest.fn() },
        },
        {
          provide: QuestionTimingService,
          useValue: { logQuestionTransition: jest.fn() },
        },
        {
          provide: ResultService,
          useValue: { calculateResult: jest.fn(), getResult: jest.fn() },
        },
      ],
    }).compile();

    languageService = module.get<LanguageService>(LanguageService);
    translationService = module.get<TranslationService>(TranslationService);
    examLanguageService = module.get<ExamLanguageService>(ExamLanguageService);
    examAttemptService = module.get<ExamAttemptService>(ExamAttemptService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  // ═════════════════════════════════════════════════════════════════
  // 1. NINE REGIONAL LANGUAGES MASTER SUITE
  // ═════════════════════════════════════════════════════════════════
  describe('1. 9 Regional Languages Master', () => {
    it('should have all 9 standardized regional languages defined', () => {
      expect(SUPPORTED_NINE_REGIONAL_LANGUAGES).toHaveLength(9);
      const codes = SUPPORTED_NINE_REGIONAL_LANGUAGES.map((l) => l.code);
      expect(codes).toEqual([
        'en',
        'kn',
        'hi',
        'ta',
        'te',
        'mr',
        'ml',
        'bn',
        'gu',
      ]);
    });

    it('should seed 9 regional languages on boot if not existing', async () => {
      mockPrisma.preferredLanguage.findFirst.mockResolvedValue(null);
      mockPrisma.preferredLanguage.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'lang-uuid', ...data }),
      );

      await languageService.seedNineRegionalLanguages();

      expect(mockPrisma.preferredLanguage.create).toHaveBeenCalledTimes(9);
      expect(mockPrisma.preferredLanguage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'hi', nativeName: 'हिन्दी' }),
        }),
      );
    });

    it('should retrieve active languages sorted by displayOrder', async () => {
      const mockList = [
        {
          id: '1',
          code: 'en',
          name: 'English',
          nativeName: 'English',
          displayOrder: 1,
          isActive: true,
        },
        {
          id: '2',
          code: 'hi',
          name: 'Hindi',
          nativeName: 'हिन्दी',
          displayOrder: 2,
          isActive: true,
        },
      ];
      mockPrisma.preferredLanguage.findMany.mockResolvedValue(mockList);

      const result = await languageService.getAllLanguages();
      expect(result).toEqual(mockList);
      expect(mockPrisma.preferredLanguage.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      });
    });

    it('should find language by ISO code (case-insensitive)', async () => {
      mockPrisma.preferredLanguage.findUnique.mockResolvedValue({
        id: 'lang-gu',
        code: 'gu',
        name: 'Gujarati',
        nativeName: 'ગુજરાતી',
      });

      const res = await languageService.getLanguageByCode('GU');
      expect(res.code).toBe('gu');
      expect(res.name).toBe('Gujarati');
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 2. HUMAN-CREATED TRANSLATION ARCHITECTURE
  // ═════════════════════════════════════════════════════════════════
  describe('2. Translation Architecture & Completeness', () => {
    const questionId = 'q-101';
    const hindiLangId = 'lang-hi-uuid';

    it('should atomically upsert a full question translation with option translations', async () => {
      mockPrisma.preferredLanguage.findUnique.mockResolvedValue({
        id: hindiLangId,
        code: 'hi',
        name: 'Hindi',
      });
      mockPrisma.question.findUnique.mockResolvedValue({
        id: questionId,
        options: [{ id: 'opt-501' }, { id: 'opt-502' }],
      });
      mockPrisma.questionTranslation.upsert.mockResolvedValue({
        id: 'qt-1',
        questionId,
        languageId: hindiLangId,
        questionText: 'कोशिका का पावरहाउस क्या है?',
      });
      mockPrisma.questionOptionTranslation.upsert.mockResolvedValue({
        id: 'qot-1',
        optionId: 'opt-501',
        languageId: hindiLangId,
        optionText: 'माइटोकॉन्ड्रिया',
      });

      const res = await translationService.upsertFullQuestionTranslation(
        questionId,
        {
          languageId: hindiLangId,
          questionText: 'कोशिका का पावरहाउस क्या है?',
          optionTranslations: [
            { optionId: 'opt-501', optionText: 'माइटोकॉन्ड्रिया' },
            { optionId: 'opt-502', optionText: 'राइबोसोम' },
          ],
        },
      );

      expect(res.questionTranslation.questionText).toBe(
        'कोशिका का पावरहाउस क्या है?',
      );
      expect(mockPrisma.questionTranslation.upsert).toHaveBeenCalled();
      expect(mockPrisma.questionOptionTranslation.upsert).toHaveBeenCalledTimes(
        2,
      );
    });

    it('should calculate translation completeness matrix across all languages', async () => {
      mockPrisma.question.findUnique.mockResolvedValue({
        id: questionId,
        defaultLanguageId: 'lang-en',
        translations: [
          { languageId: 'lang-en', questionText: 'What is mitochondria?' },
          { languageId: 'lang-hi', questionText: 'माइटोकॉन्ड्रिया क्या है?' },
        ],
        options: [
          {
            id: 'opt-1',
            translations: [
              { languageId: 'lang-en', optionText: 'Powerhouse' },
              { languageId: 'lang-hi', optionText: 'पावरहाउस' },
            ],
          },
        ],
      });

      mockPrisma.preferredLanguage.findMany.mockResolvedValue([
        { id: 'lang-en', code: 'en', name: 'English', nativeName: 'English' },
        { id: 'lang-hi', code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
        { id: 'lang-gu', code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
      ]);

      const report =
        await translationService.getTranslationCompleteness(questionId);

      expect(report.completeness).toHaveLength(3);
      expect(report.completeness[0].languageCode).toBe('en');
      expect(report.completeness[0].isComplete).toBe(true);
      expect(report.completeness[1].languageCode).toBe('hi');
      expect(report.completeness[1].isComplete).toBe(true);
      expect(report.completeness[2].languageCode).toBe('gu');
      expect(report.completeness[2].isComplete).toBe(false);
      expect(report.isFullyTranslatedAllLanguages).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 3. EXAM LANGUAGE CONFIGURATION
  // ═════════════════════════════════════════════════════════════════
  describe('3. Exam Language Configuration', () => {
    const examId = 'exam-1001';

    it('should configure allowed languages for an exam and enforce a default', async () => {
      mockPrisma.exam.findUnique.mockResolvedValue({ id: examId });
      mockPrisma.examLanguage.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.examLanguage.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'el-1', ...data }),
      );

      const res = await examLanguageService.setExamLanguages(examId, {
        languages: [
          { languageId: 'lang-en', isDefault: true, displayOrder: 1 },
          { languageId: 'lang-hi', isDefault: false, displayOrder: 2 },
          { languageId: 'lang-gu', isDefault: false, displayOrder: 3 },
        ],
      });

      expect(res).toHaveLength(3);
      expect(mockPrisma.examLanguage.deleteMany).toHaveBeenCalledWith({
        where: { examId },
      });
      expect(mockPrisma.examLanguage.create).toHaveBeenCalledTimes(3);
    });

    it('should validate if a language is enabled for an exam', async () => {
      mockPrisma.examLanguage.findFirst.mockResolvedValue({
        id: 'el-1',
        examId,
        languageId: 'lang-hi',
        language: { isActive: true },
      });

      const isAllowed = await examLanguageService.validateExamLanguageAllowed(
        examId,
        'lang-hi',
      );
      expect(isAllowed).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 4. IN-FLIGHT EXAM LANGUAGE SWITCHING & ANSWER PRESERVATION
  // ═════════════════════════════════════════════════════════════════
  describe('4. In-Flight Language Switching & Answer State Preservation', () => {
    const attemptId = 'att-999';
    const studentId = 'stu-123';
    const examId = 'exam-1001';
    const hindiLangId = 'lang-hi-uuid';
    const gujaratiLangId = 'lang-gu-uuid';

    const activeAttempt = {
      id: attemptId,
      studentId,
      examId,
      languageId: 'lang-en-uuid',
      status: { name: 'IN_PROGRESS' },
      serverEndTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour remaining
    };

    it('should switch attempt language from English to Hindi without restarting or modifying answers', async () => {
      mockPrisma.attempt.findUnique.mockResolvedValue(activeAttempt);
      mockPrisma.preferredLanguage.findUnique.mockResolvedValue({
        id: hindiLangId,
        code: 'hi',
        name: 'Hindi',
        nativeName: 'हिन्दी',
        isActive: true,
      });
      mockPrisma.examLanguage.count.mockResolvedValue(1);
      mockPrisma.examLanguage.findFirst.mockResolvedValue({
        examId,
        languageId: hindiLangId,
      });
      mockPrisma.attempt.update.mockResolvedValue({
        ...activeAttempt,
        languageId: hindiLangId,
      });

      const res = await examAttemptService.switchAttemptLanguage(
        attemptId,
        hindiLangId,
        studentId,
      );

      expect(res.attemptId).toBe(attemptId);
      expect(res.language.code).toBe('hi');
      expect(res.language.nativeName).toBe('हिन्दी');
      expect(mockPrisma.attempt.update).toHaveBeenCalledWith({
        where: { id: attemptId },
        data: { languageId: hindiLangId },
      });
      // CRITICAL: Ensure no answer table deletions or resets occurred
      expect(mockPrisma.answer.upsert).not.toHaveBeenCalled();
    });

    it('should preserve selectedOptionId (501) across language switch English -> Hindi -> Gujarati', async () => {
      // Simulate answer state before switch
      const storedAnswer = {
        attemptId,
        examQuestionId: 'eq-1',
        selectedOptionId: '501-uuid', // Underlyng Option ID
        numericalAnswer: null,
        selectedOptions: ['501-uuid', '503-uuid'],
        isMarkedForReview: true,
        answeredAt: new Date(),
      };

      mockPrisma.answer.findMany.mockResolvedValue([storedAnswer]);
      mockPrisma.attempt.findUnique.mockResolvedValue(activeAttempt);

      // Verify Attempt status before switch
      const statusBefore = await examAttemptService.getAttemptStatus(
        attemptId,
        studentId,
      );
      expect(statusBefore.answers[0].selectedOptionId).toBe('501-uuid');
      expect(statusBefore.answers[0].selectedOptions).toEqual([
        '501-uuid',
        '503-uuid',
      ]);

      // Switch language to Gujarati
      mockPrisma.preferredLanguage.findUnique.mockResolvedValue({
        id: gujaratiLangId,
        code: 'gu',
        name: 'Gujarati',
        nativeName: 'ગુજરાતી',
        isActive: true,
      });
      mockPrisma.examLanguage.count.mockResolvedValue(0); // all active allowed
      await examAttemptService.switchAttemptLanguage(
        attemptId,
        gujaratiLangId,
        studentId,
      );

      // Verify Attempt status after switch: Answer state is 100% IDENTICAL
      const statusAfter = await examAttemptService.getAttemptStatus(
        attemptId,
        studentId,
      );
      expect(statusAfter.answers[0].selectedOptionId).toBe('501-uuid');
      expect(statusAfter.answers[0].selectedOptions).toEqual([
        '501-uuid',
        '503-uuid',
      ]);
      expect(statusAfter.answers[0].isMarkedForReview).toBe(true);
    });

    it('should reject language switch if language is not enabled for the exam', async () => {
      mockPrisma.attempt.findUnique.mockResolvedValue(activeAttempt);
      mockPrisma.preferredLanguage.findUnique.mockResolvedValue({
        id: 'lang-ta-uuid',
        code: 'ta',
        name: 'Tamil',
        isActive: true,
      });
      mockPrisma.examLanguage.count.mockResolvedValue(2);
      mockPrisma.examLanguage.findFirst.mockResolvedValue(null); // Not enabled

      let error: any;
      try {
        await examAttemptService.switchAttemptLanguage(
          attemptId,
          'lang-ta-uuid',
          studentId,
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
    });

    it('should reject language switch if attempt is already SUBMITTED', async () => {
      mockPrisma.attempt.findUnique.mockResolvedValue({
        ...activeAttempt,
        status: { name: 'SUBMITTED' },
      });

      let error: any;
      try {
        await examAttemptService.switchAttemptLanguage(
          attemptId,
          hindiLangId,
          studentId,
        );
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.message).toBe('This attempt is not in progress');
    });
  });
});
