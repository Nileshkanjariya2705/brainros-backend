import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller';
import { PublicExamController } from './controllers/public-exam.controller';
import { ExamManagerController } from './controllers/exam-manager.controller';
import { ExamService } from './exam.service';
import { ExamPaperParserService } from './services/exam-paper-parser.service';
import { ExamPaperValidatorService } from './services/exam-paper-validator.service';
import { ExamPaperImportService } from './services/exam-paper-import.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'exam-generation',
    }),
  ],
  controllers: [
    ExamController,
    PublicExamController,
    ExamManagerController,
  ],
  providers: [
    ExamService,
    ExamPaperParserService,
    ExamPaperValidatorService,
    ExamPaperImportService,
  ],
  exports: [
    ExamService,
    ExamPaperParserService,
    ExamPaperValidatorService,
    ExamPaperImportService,
    BullModule,
  ],
})
export class ExamModule {}
