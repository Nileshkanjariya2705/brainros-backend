import { Test, TestingModule } from '@nestjs/testing';
import { QuestionImportService } from './question-import.service';
import { QuestionBankService } from '../question-bank.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  QuestionImportStatus,
  QuestionImportRowStatus,
  QuestionImportRowAction,
  QuestionTypeEnum,
} from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

describe('QuestionImportService', () => {
  let service: QuestionImportService;
  let prisma: any;
  let questionBankService: any;

  const mockSubject = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Physics',
    code: 'PHY',
    examTargetId: 'target-1',
  };

  const mockChapter = {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Electrostatics',
    subjectId: mockSubject.id,
  };

  const mockTopic = {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Coulombs Law',
    chapterId: mockChapter.id,
  };

  const mockSubTopic = {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Force Vector',
    topicId: mockTopic.id,
  };

  const mockLanguage = {
    id: '55555555-5555-5555-5555-555555555555',
    name: 'English',
    code: 'en',
    isActive: true,
  };

  const mockExistingQuestion = {
    id: '66666666-6666-6666-6666-666666666666',
    status: 'DRAFT',
  };

  const mockPrismaService = {
    subject: { findMany: jest.fn().mockResolvedValue([mockSubject]) },
    chapter: { findMany: jest.fn().mockResolvedValue([mockChapter]) },
    topic: { findMany: jest.fn().mockResolvedValue([mockTopic]) },
    subTopic: { findMany: jest.fn().mockResolvedValue([mockSubTopic]) },
    preferredLanguage: { findMany: jest.fn().mockResolvedValue([mockLanguage]) },
    question: {
      findMany: jest.fn().mockResolvedValue([mockExistingQuestion]),
      findUnique: jest.fn(),
    },
    questionImport: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    questionImportRow: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockQuestionBankService = {
    createQuestion: jest.fn().mockResolvedValue({ id: 'new-q-1' }),
    updateQuestion: jest.fn().mockResolvedValue({ id: mockExistingQuestion.id }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionImportService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: QuestionBankService,
          useValue: mockQuestionBankService,
        },
      ],
    }).compile();

    service = module.get<QuestionImportService>(QuestionImportService);
    prisma = module.get(PrismaService);
    questionBankService = module.get(QuestionBankService);
    jest.clearAllMocks();

    mockPrismaService.subject.findMany.mockResolvedValue([mockSubject]);
    mockPrismaService.chapter.findMany.mockResolvedValue([mockChapter]);
    mockPrismaService.topic.findMany.mockResolvedValue([mockTopic]);
    mockPrismaService.subTopic.findMany.mockResolvedValue([mockSubTopic]);
    mockPrismaService.preferredLanguage.findMany.mockResolvedValue([mockLanguage]);
    mockPrismaService.question.findMany.mockResolvedValue([mockExistingQuestion]);
  });

  describe('validateFile', () => {
    it('should reject unsupported file extensions', () => {
      expect(() =>
        service.validateFile({
          originalname: 'questions.pdf',
          size: 1024,
        }),
      ).toThrow(BadRequestException);
    });

    it('should reject files exceeding 25MB', () => {
      expect(() =>
        service.validateFile({
          originalname: 'questions.csv',
          size: 30 * 1024 * 1024,
        }),
      ).toThrow(BadRequestException);
    });

    it('should accept valid CSV and XLSX files', () => {
      expect(() =>
        service.validateFile({
          originalname: 'questions.xlsx',
          size: 5000,
        }),
      ).not.toThrow();
    });
  });

  describe('generateTemplate', () => {
    it('should generate valid XLSX template buffer', async () => {
      const result = await service.generateTemplate('xlsx' as any);
      expect(result.buffer).toBeDefined();
      expect(result.fileName).toBe('question_import_template.xlsx');
      expect(result.contentType).toContain('spreadsheetml');
    });

    it('should generate valid CSV template buffer', async () => {
      const result = await service.generateTemplate('csv' as any);
      expect(result.buffer).toBeDefined();
      expect(result.fileName).toBe('question_import_template.csv');
      expect(result.contentType).toBe('text/csv');
    });
  });

  describe('parseAndValidateImport', () => {
    it('should validate CSV with single MCQ and save VALID staging row', async () => {
      const csvContent =
        'subject,chapter,question_type,difficulty,marks,negative_marks,question,option_a,option_b,option_c,option_d,correct_answer,explanation\n' +
        'Physics,Electrostatics,SINGLE_CORRECT,MEDIUM,4,1,What is the SI unit of charge?,Coulomb,Volt,Ampere,Ohm,A,Charge unit is Coulomb.\n';

      const tempFilePath = path.resolve(process.cwd(), 'storage', 'question-imports', 'test_sample.csv');
      await fs.promises.mkdir(path.dirname(tempFilePath), { recursive: true });
      await fs.promises.writeFile(tempFilePath, Buffer.from(csvContent));

      mockPrismaService.questionImport.findUnique.mockResolvedValue({
        id: 'import-1',
        fileName: 'test_sample.csv',
        fileType: 'CSV',
        storageKey: tempFilePath,
        status: QuestionImportStatus.UPLOADED,
      });

      mockPrismaService.questionImport.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'import-1', ...data }),
      );

      await service.parseAndValidateImport('import-1');

      expect(mockPrismaService.questionImportRow.createMany).toHaveBeenCalledTimes(1);
      const insertedRows = mockPrismaService.questionImportRow.createMany.mock.calls[0][0].data;

      expect(insertedRows.length).toBe(1);
      expect(insertedRows[0].status).toBe(QuestionImportRowStatus.VALID);
      expect(insertedRows[0].action).toBe(QuestionImportRowAction.CREATE);
      expect(insertedRows[0].errors).toEqual([]);

      // cleanup
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    });

    it('should flag row as UPDATE_AVAILABLE if question_id exists in database', async () => {
      const csvContent =
        'question_id,subject,chapter,question_type,difficulty,marks,negative_marks,question,option_a,option_b,correct_answer\n' +
        `${mockExistingQuestion.id},Physics,Electrostatics,SINGLE_CORRECT,EASY,4,1,Updated question statement?,Yes,No,A\n`;

      const tempFilePath = path.resolve(process.cwd(), 'storage', 'question-imports', 'test_update.csv');
      await fs.promises.writeFile(tempFilePath, Buffer.from(csvContent));

      mockPrismaService.questionImport.findUnique.mockResolvedValue({
        id: 'import-2',
        fileName: 'test_update.csv',
        fileType: 'CSV',
        storageKey: tempFilePath,
        status: QuestionImportStatus.UPLOADED,
      });

      mockPrismaService.questionImport.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'import-2', ...data }),
      );

      await service.parseAndValidateImport('import-2');

      const insertedRows = mockPrismaService.questionImportRow.createMany.mock.calls[0][0].data;
      expect(insertedRows[0].status).toBe(QuestionImportRowStatus.UPDATE_AVAILABLE);
      expect(insertedRows[0].action).toBe(QuestionImportRowAction.UPDATE);
      expect(insertedRows[0].targetQuestionId).toBe(mockExistingQuestion.id);

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    });

    it('should flag row as INVALID if question_id does not exist in database', async () => {
      const csvContent =
        'question_id,subject,chapter,question_type,question,option_a,option_b,correct_answer\n' +
        '99999999-9999-9999-9999-999999999999,Physics,Electrostatics,SINGLE_CORRECT,Question text?,Yes,No,A\n';

      const tempFilePath = path.resolve(process.cwd(), 'storage', 'question-imports', 'test_bad_id.csv');
      await fs.promises.writeFile(tempFilePath, Buffer.from(csvContent));

      mockPrismaService.questionImport.findUnique.mockResolvedValue({
        id: 'import-3',
        fileName: 'test_bad_id.csv',
        fileType: 'CSV',
        storageKey: tempFilePath,
        status: QuestionImportStatus.UPLOADED,
      });

      mockPrismaService.questionImport.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'import-3', ...data }),
      );

      await service.parseAndValidateImport('import-3');

      const insertedRows = mockPrismaService.questionImportRow.createMany.mock.calls[0][0].data;
      expect(insertedRows[0].status).toBe(QuestionImportRowStatus.INVALID);
      expect(insertedRows[0].errors.some((e: string) => e.includes('does not exist in the database'))).toBe(true);

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    });

    it('should flag row as INVALID if correct option is missing or invalid', async () => {
      const csvContent =
        'subject,chapter,question_type,question,option_a,option_b,correct_answer\n' +
        'Physics,Electrostatics,SINGLE_CORRECT,Question text?,Option A,Option B,Z\n';

      const tempFilePath = path.resolve(process.cwd(), 'storage', 'question-imports', 'test_bad_ans.csv');
      await fs.promises.writeFile(tempFilePath, Buffer.from(csvContent));

      mockPrismaService.questionImport.findUnique.mockResolvedValue({
        id: 'import-4',
        fileName: 'test_bad_ans.csv',
        fileType: 'CSV',
        storageKey: tempFilePath,
        status: QuestionImportStatus.UPLOADED,
      });

      mockPrismaService.questionImport.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'import-4', ...data }),
      );

      await service.parseAndValidateImport('import-4');

      const insertedRows = mockPrismaService.questionImportRow.createMany.mock.calls[0][0].data;
      expect(insertedRows[0].status).toBe(QuestionImportRowStatus.INVALID);
      expect(insertedRows[0].errors.some((e: string) => e.includes('exactly one correct option'))).toBe(true);

      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    });
  });

  describe('executeImport', () => {
    it('should execute batch creations and updates using existing QuestionBankService', async () => {
      mockPrismaService.questionImport.findUnique.mockResolvedValue({
        id: 'import-5',
        status: QuestionImportStatus.READY_TO_IMPORT,
      });

      const candidateRows = [
        {
          id: 'row-1',
          rowNumber: 1,
          status: QuestionImportRowStatus.VALID,
          action: QuestionImportRowAction.CREATE,
          targetQuestionId: null,
          dtoData: {
            subjectId: mockSubject.id,
            chapterId: mockChapter.id,
            type: QuestionTypeEnum.SINGLE_CORRECT,
            defaultLanguageId: mockLanguage.id,
            marks: 4,
            negativeMarks: 1,
            translations: [{ languageId: mockLanguage.id, questionText: 'Q1' }],
            options: [{ optionKey: 'A', optionLabel: 'Opt A', isCorrect: true, displayOrder: 0 }],
          },
        },
        {
          id: 'row-2',
          rowNumber: 2,
          status: QuestionImportRowStatus.UPDATE_AVAILABLE,
          action: QuestionImportRowAction.UPDATE,
          targetQuestionId: mockExistingQuestion.id,
          dtoData: {
            subjectId: mockSubject.id,
            chapterId: mockChapter.id,
            type: QuestionTypeEnum.SINGLE_CORRECT,
            defaultLanguageId: mockLanguage.id,
            marks: 4,
            negativeMarks: 1,
            translations: [{ languageId: mockLanguage.id, questionText: 'Q2 Updated' }],
          },
        },
      ];

      mockPrismaService.questionImportRow.findMany.mockResolvedValue(candidateRows);
      mockPrismaService.questionImport.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'import-5', ...data }),
      );

      const result = await service.executeImport('import-5', 'user-123');

      expect(mockQuestionBankService.createQuestion).toHaveBeenCalledTimes(1);
      expect(mockQuestionBankService.updateQuestion).toHaveBeenCalledTimes(1);
      expect(result.createdCount).toBe(1);
      expect(result.updatedCount).toBe(1);
      expect(result.status).toBe(QuestionImportStatus.COMPLETED);
    });
  });
});
