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

  it('should validate a correct question paper dataset', async () => {
    const rows: ParsedExamPaperRow[] = [
      {
        rowNumber: 2,
        examCode: 'NEET-01',
        examName: 'NEET Test',
        durationMinutes: 200,
        subject: 'Physics',
        sectionName: 'Section A',
        questionType: 'SINGLE_CORRECT',
        questionText: 'What is gravitational constant?',
        optionA: '6.67 x 10^-11',
        optionB: '9.8',
        optionC: '3 x 10^8',
        optionD: '1.6 x 10^-19',
        correctAnswer: 'A',
        marks: 4,
        negativeMarks: 1,
        difficulty: 'EASY',
      },
    ];

    const result = await service.validatePaper(rows);
    expect(result.isValid).toBe(true);
    expect(result.validRows).toBe(1);
    expect(result.invalidRows).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it('should detect missing question text and invalid correct answer', async () => {
    const rows: ParsedExamPaperRow[] = [
      {
        rowNumber: 2,
        examCode: 'NEET-01',
        examName: 'NEET Test',
        durationMinutes: 200,
        subject: 'Physics',
        sectionName: 'Section A',
        questionType: 'SINGLE_CORRECT',
        questionText: '', // missing!
        optionA: 'Opt 1',
        optionB: 'Opt 2',
        correctAnswer: 'Z', // invalid option key!
        marks: 4,
        negativeMarks: 1,
      },
    ];

    const result = await service.validatePaper(rows);
    expect(result.isValid).toBe(false);
    expect(result.validRows).toBe(0);
    expect(result.invalidRows).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
