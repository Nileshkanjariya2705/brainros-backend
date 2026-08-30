import { ExamPaperParserService } from './exam-paper-parser.service';
import * as ExcelJS from 'exceljs';

describe('ExamPaperParserService', () => {
  let service: ExamPaperParserService;

  beforeEach(() => {
    service = new ExamPaperParserService();
  });

  describe('parseCsv', () => {
    it('should parse valid CSV text into structured question rows', async () => {
      const csvData = [
        'exam_code,exam_name,subject,question_number,question_type,question_text,option_a,option_b,option_c,option_d,correct_answer,marks',
        'TEST-01,Sample Exam,Physics,1,SINGLE_CORRECT,"What is acceleration?",10,20,30,40,B,4',
        'TEST-01,Sample Exam,Chemistry,2,SINGLE_CORRECT,"What is pH of water?",5,6,7,8,C,4',
      ].join('\n');

      const rows = await service.parseBuffer(Buffer.from(csvData), 'sample.csv');
      expect(rows).toHaveLength(2);
      expect(rows[0].examCode).toBe('TEST-01');
      expect(rows[0].subject).toBe('Physics');
      expect(rows[0].questionText).toBe('What is acceleration?');
      expect(rows[0].correctAnswer).toBe('B');
      expect(rows[1].subject).toBe('Chemistry');
    });

    it('should throw BadRequestException if CSV has no data rows', async () => {
      const emptyCsv = 'exam_code,exam_name,subject\n';
      await expect(
        service.parseBuffer(Buffer.from(emptyCsv), 'empty.csv'),
      ).rejects.toThrow('must contain a header and at least one question row');
    });
  });

  describe('parseExcel', () => {
    it('should parse valid XLSX workbook into structured rows', async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('QuestionPaper');
      worksheet.addRow([
        'exam_code',
        'exam_name',
        'subject',
        'question_text',
        'option_a',
        'option_b',
        'correct_answer',
      ]);
      worksheet.addRow([
        'NEET-01',
        'NEET Paper',
        'Biology',
        'What is cell membrane?',
        'Lipid bilayer',
        'Protein layer',
        'A',
      ]);

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const rows = await service.parseBuffer(buffer, 'test.xlsx');
      expect(rows).toHaveLength(1);
      expect(rows[0].examCode).toBe('NEET-01');
      expect(rows[0].subject).toBe('Biology');
      expect(rows[0].optionA).toBe('Lipid bilayer');
      expect(rows[0].correctAnswer).toBe('A');
    });
  });
});
