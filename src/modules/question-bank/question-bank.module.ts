import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QuestionBankController } from './question-bank.controller';
import { QuestionBankService } from './question-bank.service';
import { QuestionImportService } from './services/question-import.service';
import { QuestionImportProcessor } from './processors/question-import.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'question-import',
    }),
  ],
  controllers: [QuestionBankController],
  providers: [
    QuestionBankService,
    QuestionImportService,
    QuestionImportProcessor,
  ],
  exports: [QuestionBankService, QuestionImportService],
})
export class QuestionBankModule {}
