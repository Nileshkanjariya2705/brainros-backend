import { Test, TestingModule } from '@nestjs/testing';
import { ExamPaperValidatorService } from './exam-paper-validator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ParsedExamPaperRow } from '../dto/exam-manager.dto';

describe('ExamPaperValidatorService', () => {
  let service: ExamPaperValidatorService;
  let prisma: any;

  const mockPrismaService = {
    examTarget: { findMany: jest.fn().mockResolvedValue([{ id: '1', name: 'NEET' }]) },
    subject: {
      findMany: jest.fn().mockResolvedValue([
        { id: '10', name: 'Physics', examTargetId: '1' },
        { id: '11', name: 'Chemistry', examTargetId: '1' },
      ]),
    },
    preferredLanguage: {
      findMany: jest.fn().mockResolvedValue([{ id: '100', code: 'en', name: 'English' }]),
    },
    exam: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamPaperValidatorService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ExamPaperValidatorService>(ExamPaperValidatorService);
    prisma = module.get(PrismaService);
  });

  it('should validate a correct 6-column question paper dataset', async () => {
    const rows: ParsedExamPaperRow[] = [
      {
        rowNumber: 2,
        questionNumber: 1,
        questionText: 'What is 2 + 2?',
        optionA: '2',
        optionB: '3',
        optionC: '4',
        optionD: '5',
      },
    ];

    const result = await service.validatePaper(rows);
    expect(result.isValid).toBe(true);
    expect(result.validRows).toBe(1);
    expect(result.invalidRows).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing question text and invalid question number', async () => {
    const rows: ParsedExamPaperRow[] = [
      {
        rowNumber: 2,
        questionNumber: -1, // invalid!
        questionText: '', // missing!
        optionA: 'Opt 1',
        optionB: '', // missing!
      },
    ];

    const result = await service.validatePaper(rows);
    expect(result.isValid).toBe(false);
    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
