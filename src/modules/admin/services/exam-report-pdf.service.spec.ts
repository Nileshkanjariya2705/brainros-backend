import { Test, TestingModule } from '@nestjs/testing';
import { ExamReportPdfService, ExamReportPdfData } from './exam-report-pdf.service';

describe('ExamReportPdfService', () => {
  let service: ExamReportPdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExamReportPdfService],
    }).compile();

    service = module.get<ExamReportPdfService>(ExamReportPdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a valid PDF Buffer with full report sections', async () => {
    const mockData: ExamReportPdfData = {
      student: {
        name: 'Rahul Patel',
        studentCode: 'BRN-10001',
        email: 'rahul@example.com',
      },
      exam: {
        title: 'NEET Live Grand Exam 01',
        examDate: new Date('2026-09-01'),
        totalMarks: 720,
        durationMinutes: 180,
      },
      attempt: {
        id: 'attempt-uuid-1',
        submittedAt: new Date('2026-09-01T15:00:00Z'),
        score: 485,
        maxScore: 720,
        percentage: 67.36,
        accuracy: 78.5,
        totalQuestions: 180,
        correctAnswers: 130,
        wrongAnswers: 35,
        unattempted: 15,
        timeUsedSeconds: 9800,
        averageTimePerQuestion: 54.4,
      },
      rank: {
        rank: 2841,
        totalCandidates: 10000,
        percentile: 71.59,
      },
      subjects: [
        {
          name: 'Physics',
          score: 120,
          maxScore: 180,
          accuracy: 75.0,
          correct: 32,
          wrong: 10,
          unattempted: 3,
        },
        {
          name: 'Chemistry',
          score: 135,
          maxScore: 180,
          accuracy: 80.0,
          correct: 36,
          wrong: 8,
          unattempted: 1,
        },
        {
          name: 'Biology',
          score: 230,
          maxScore: 360,
          accuracy: 82.0,
          correct: 62,
          wrong: 17,
          unattempted: 11,
        },
      ],
      timeAnalysis: {
        averageTimePerQuestionSeconds: 54.4,
        fastestQuestionSeconds: 12,
        slowestQuestionSeconds: 110,
      },
      strategy: {
        overAttemptingScore: 2,
        avoidableLossMarks: 35,
        riskCategory: 'BALANCED',
        recommendations: [
          'Improve chemistry inorganic revision.',
          'Focus on time management in section B.',
        ],
      },
    };

    const pdfBuffer = await service.generateReportPdf(mockData);

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // PDF Magic Number %PDF-
    expect(pdfBuffer.toString('utf8', 0, 4)).toEqual('%PDF');
  });
});
