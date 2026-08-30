import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TranslationImportService } from './translation-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TranslationImportFormatEnum } from '../dto/translation-import.dto';

describe('TranslationImportService', () => {
  let service: TranslationImportService;
  let prisma: any;

  const mockPrismaService = {
    question: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    preferredLanguage: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    questionTranslation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    questionOptionTranslation: {
      upsert: jest.fn(),
    },
    translationImport: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    translationImportRow: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(async (cb) => cb(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationImportService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<TranslationImportService>(TranslationImportService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('validateFile', () => {
    it('should reject unsupported file extensions', () => {
      expect(() =>
        service.validateFile({
          originalname: 'translations.pdf',
          size: 1024,
          buffer: Buffer.from('test'),
        }),
      ).toThrow(BadRequestException);
    });

    it('should reject files exceeding 25MB', () => {
      expect(() =>
        service.validateFile({
          originalname: 'translations.csv',
          size: 30 * 1024 * 1024,
          buffer: Buffer.from('large'),
        }),
      ).toThrow(BadRequestException);
    });

    it('should accept valid CSV and XLSX files', () => {
      expect(() =>
        service.validateFile({
          originalname: 'translations.csv',
          size: 1024,
          buffer: Buffer.from('valid'),
        }),
      ).not.toThrow();

      expect(() =>
        service.validateFile({
          originalname: 'translations.xlsx',
          size: 2048,
          buffer: Buffer.from('valid'),
        }),
      ).not.toThrow();
    });
  });

  describe('generateTemplate', () => {
    it('should generate valid XLSX template buffer', async () => {
      prisma.question.findMany.mockResolvedValue([]);
      prisma.preferredLanguage.findMany.mockResolvedValue([
        { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
      ]);

      const result = await service.generateTemplate(TranslationImportFormatEnum.XLSX);
      expect(result.fileName).toBe('question_translation_template.xlsx');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('should generate valid CSV template buffer', async () => {
      prisma.question.findMany.mockResolvedValue([]);
      prisma.preferredLanguage.findMany.mockResolvedValue([]);

      const result = await service.generateTemplate(TranslationImportFormatEnum.CSV);
      expect(result.fileName).toBe('question_translation_template.csv');
      expect(result.buffer.toString('utf-8')).toContain('question_id,language_code,question_text');
    });
  });
});
