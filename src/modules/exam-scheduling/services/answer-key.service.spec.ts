import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AnswerKeyService } from './answer-key.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { EVALUATION_QUEUE_NAME } from '../../result/interfaces/result-lifecycle.interface';

describe('AnswerKeyService (Simplified Format & Scoped Question Mapping)', () => {
  let service: AnswerKeyService;
  let prisma: any;
  let queue: any;

  const mockQuestions = [
    {
      id: 'q-uuid-1',
      sequenceNumber: 1,
      type: 'SINGLE_CORRECT',
      sourceQuestionId: 'source-q-1',
      options: [
        { id: 'opt-1-a', optionKey: 'A', isCorrect: false },
        { id: 'opt-1-b', optionKey: 'B', isCorrect: false },
        { id: 'opt-1-c', optionKey: 'C', isCorrect: false },
        { id: 'opt-1-d', optionKey: 'D', isCorrect: false },
      ],
    },
    {
      id: 'q-uuid-2',
      sequenceNumber: 2,
      type: 'SINGLE_CORRECT',
      sourceQuestionId: 'source-q-2',
      options: [
        { id: 'opt-2-a', optionKey: 'A', isCorrect: false },
        { id: 'opt-2-b', optionKey: 'B', isCorrect: false },
        { id: 'opt-2-c', optionKey: 'C', isCorrect: false },
        { id: 'opt-2-d', optionKey: 'D', isCorrect: false },
      ],
    },
    {
      id: 'q-uuid-3',
      sequenceNumber: 3,
      type: 'MULTIPLE_CORRECT',
      sourceQuestionId: 'source-q-3',
      options: [
        { id: 'opt-3-a', optionKey: 'A', isCorrect: false },
        { id: 'opt-3-b', optionKey: 'B', isCorrect: false },
        { id: 'opt-3-c', optionKey: 'C', isCorrect: false },
        { id: 'opt-3-d', optionKey: 'D', isCorrect: false },
      ],
    },
    {
      id: 'q-uuid-4',
      sequenceNumber: 4,
      type: 'NUMERICAL',
      sourceQuestionId: 'source-q-4',
      options: [],
    },
    {
      id: 'q-uuid-5',
      sequenceNumber: 5,
      type: 'SINGLE_CORRECT',
      sourceQuestionId: 'source-q-5',
      options: [
        { id: 'opt-5-a', optionKey: 'A', isCorrect: false },
        { id: 'opt-5-b', optionKey: 'B', isCorrect: false },
        { id: 'opt-5-c', optionKey: 'C', isCorrect: false },
        { id: 'opt-5-d', optionKey: 'D', isCorrect: false },
      ],
    },
  ];

  const mockSchedule = {
    id: 'schedule-123',
    examId: 'exam-123',
    examVersionId: 'version-101',
    status: 'ENDED',
    endTime: new Date(Date.now() - 3600000), // 1 hour ago
    hasAnswerKey: false,
    exam: {
      id: 'exam-123',
      title: 'NEET Official Exam 01',
    },
    examVersion: {
      id: 'version-101',
      questions: mockQuestions,
    },
  };

  beforeEach(async () => {
    prisma = {
      examSchedule: {
        findUnique: jest.fn().mockResolvedValue(mockSchedule),
        update: jest.fn().mockResolvedValue({ ...mockSchedule, hasAnswerKey: true }),
      },
      attempt: {
        count: jest.fn().mockResolvedValue(10),
        findMany: jest.fn().mockResolvedValue([{ id: 'att-1' }]),
      },
      result: {
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn().mockResolvedValue({ id: 'res-1' }),
      },
      examVersionOption: {
        update: jest.fn().mockResolvedValue({}),
      },
      examVersionQuestion: {
        update: jest.fn().mockResolvedValue({}),
      },
      questionOption: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      questionAnswer: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      questionExplanation: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      examResultPublication: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      securityEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnswerKeyService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(EVALUATION_QUEUE_NAME), useValue: queue },
      ],
    }).compile();

    service = module.get<AnswerKeyService>(AnswerKeyService);
  });

  describe('CSV & Excel Parsing (question_number,correct_answer)', () => {
    it('should parse simple 2-column CSV correctly', async () => {
      const csv = `question_number,correct_answer
1,A
2,B
3,A|C
4,42
5,D`;
      const rows = await service.parseCsvAnswerKey(Buffer.from(csv));
      expect(rows).toHaveLength(5);
      expect(rows[0]).toEqual({ questionNumber: 1, correctOption: 'A', explanation: undefined });
      expect(rows[2]).toEqual({ questionNumber: 3, correctOption: 'A|C', explanation: undefined });
      expect(rows[3]).toEqual({ questionNumber: 4, correctOption: '42', explanation: undefined });
    });

    it('should throw BadRequestException if required headers are missing', async () => {
      const csv = `col_a,col_b
1,A
2,B`;
      await expect(service.parseCsvAnswerKey(Buffer.from(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should generate valid sample CSV with question_number,correct_answer', () => {
      const sample = service.generateSampleCsv();
      expect(sample).toContain('question_number,correct_answer');
      expect(sample).toContain('1,A');
      expect(sample).toContain('10,B');
    });

    it('should generate valid sample Excel workbook buffer', async () => {
      const buffer = await service.generateSampleExcel();
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
    });
  });

  describe('Validation Rules & Exact Error Messages', () => {
    it('should reject duplicate question numbers with exact message', async () => {
      const rows = [
        { questionNumber: 1, correctOption: 'A' },
        { questionNumber: 1, correctOption: 'B' },
        { questionNumber: 2, correctOption: 'B' },
        { questionNumber: 3, correctOption: 'A|C' },
        { questionNumber: 4, correctOption: '42' },
        { questionNumber: 5, correctOption: 'D' },
      ];

      await expect(
        service.uploadAnswerKey('schedule-123', rows, 'user-admin'),
      ).rejects.toThrow('Duplicate question number: 1');
    });

    it('should reject missing question numbers with exact message', async () => {
      const rows = [
        { questionNumber: 1, correctOption: 'A' },
        { questionNumber: 2, correctOption: 'B' },
        // Question 3 missing
        { questionNumber: 4, correctOption: '42' },
        { questionNumber: 5, correctOption: 'D' },
      ];

      await expect(
        service.uploadAnswerKey('schedule-123', rows, 'user-admin'),
      ).rejects.toThrow('Missing answer for question number: 3');
    });

    it('should reject extra question numbers not in exam version', async () => {
      const rows = [
        { questionNumber: 1, correctOption: 'A' },
        { questionNumber: 2, correctOption: 'B' },
        { questionNumber: 3, correctOption: 'A|C' },
        { questionNumber: 4, correctOption: '42' },
        { questionNumber: 5, correctOption: 'D' },
        { questionNumber: 101, correctOption: 'A' },
      ];

      await expect(
        service.uploadAnswerKey('schedule-123', rows, 'user-admin'),
      ).rejects.toThrow('Question number 101 does not exist in this exam.');
    });

    it('should reject invalid option not in question options', async () => {
      const rows = [
        { questionNumber: 1, correctOption: 'Z' }, // Z is invalid
        { questionNumber: 2, correctOption: 'B' },
        { questionNumber: 3, correctOption: 'A|C' },
        { questionNumber: 4, correctOption: '42' },
        { questionNumber: 5, correctOption: 'D' },
      ];

      await expect(
        service.uploadAnswerKey('schedule-123', rows, 'user-admin'),
      ).rejects.toThrow("Invalid answer 'Z' for question 1.");
    });

    it('should reject non-numerical answers for numerical question', async () => {
      const rows = [
        { questionNumber: 1, correctOption: 'A' },
        { questionNumber: 2, correctOption: 'B' },
        { questionNumber: 3, correctOption: 'A|C' },
        { questionNumber: 4, correctOption: 'INVALID_TEXT' }, // Q4 is numerical
        { questionNumber: 5, correctOption: 'D' },
      ];

      await expect(
        service.uploadAnswerKey('schedule-123', rows, 'user-admin'),
      ).rejects.toThrow('Question 4 requires a numerical answer.');
    });

    it('should reject multiple options for single-choice question', async () => {
      const rows = [
        { questionNumber: 1, correctOption: 'A|B' }, // Q1 is single-correct
        { questionNumber: 2, correctOption: 'B' },
        { questionNumber: 3, correctOption: 'A|C' },
        { questionNumber: 4, correctOption: '42' },
        { questionNumber: 5, correctOption: 'D' },
      ];

      await expect(
        service.uploadAnswerKey('schedule-123', rows, 'user-admin'),
      ).rejects.toThrow(
        'Question 1 is a single-choice question and accepts only one option.',
      );
    });
  });

  describe('Successful Persistence & Scoping to ExamVersion', () => {
    it('should successfully save valid answer key and enqueue BullMQ evaluation', async () => {
      const validRows = [
        { questionNumber: 1, correctOption: 'A' },
        { questionNumber: 2, correctOption: 'B' },
        { questionNumber: 3, correctOption: 'A|C' },
        { questionNumber: 4, correctOption: '42' },
        { questionNumber: 5, correctOption: 'D' },
      ];

      const result = await service.uploadAnswerKey(
        'schedule-123',
        validRows,
        'user-admin',
      );

      expect(result.success).toBe(true);
      expect(result.configuredQuestions).toBe(5);
      expect(result.enqueuedEvaluations).toBe(1);

      // Verify transaction executed
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.examSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'schedule-123' },
          data: expect.objectContaining({ hasAnswerKey: true }),
        }),
      );

      // Verify BullMQ job added
      expect(queue.add).toHaveBeenCalledWith(
        'EVALUATE_ATTEMPT',
        expect.objectContaining({
          attemptId: 'att-1',
          evaluationMode: 'DEFERRED',
        }),
        expect.any(Object),
      );
    });

    it('should support same question number in different ExamVersions without collision', async () => {
      // ExamVersion A: Q#1 -> 'q-version-a-1'
      const versionAQuestions = [
        {
          id: 'q-version-a-1',
          sequenceNumber: 1,
          type: 'SINGLE_CORRECT',
          options: [{ id: 'opt-a-1', optionKey: 'A', isCorrect: false }],
        },
      ];
      // ExamVersion B: Q#1 -> 'q-version-b-1'
      const versionBQuestions = [
        {
          id: 'q-version-b-1',
          sequenceNumber: 1,
          type: 'SINGLE_CORRECT',
          options: [{ id: 'opt-b-1', optionKey: 'B', isCorrect: false }],
        },
      ];

      // Schedule A
      prisma.examSchedule.findUnique.mockResolvedValueOnce({
        id: 'schedule-a',
        examId: 'exam-a',
        examVersionId: 'version-a',
        status: 'ENDED',
        exam: { id: 'exam-a', title: 'Exam A' },
        examVersion: { id: 'version-a', questions: versionAQuestions },
      });

      const resA = await service.uploadAnswerKey(
        'schedule-a',
        [{ questionNumber: 1, correctOption: 'A' }],
        'user-admin',
      );
      expect(resA.success).toBe(true);
      expect(prisma.examVersionQuestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-version-a-1' },
        }),
      );

      // Schedule B with Q#1
      prisma.examSchedule.findUnique.mockResolvedValueOnce({
        id: 'schedule-b',
        examId: 'exam-b',
        examVersionId: 'version-b',
        status: 'ENDED',
        exam: { id: 'exam-b', title: 'Exam B' },
        examVersion: { id: 'version-b', questions: versionBQuestions },
      });

      const resB = await service.uploadAnswerKey(
        'schedule-b',
        [{ questionNumber: 1, correctOption: 'B' }],
        'user-admin',
      );
      expect(resB.success).toBe(true);
      expect(prisma.examVersionQuestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-version-b-1' },
        }),
      );
    });
  });
});
