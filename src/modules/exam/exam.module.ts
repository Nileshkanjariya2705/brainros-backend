import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller';
import { PublicExamController } from './controllers/public-exam.controller';
import { ExamService } from './exam.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'exam-generation',
    }),
  ],
  controllers: [ExamController, PublicExamController],
  providers: [ExamService],
  exports: [ExamService, BullModule],
})
export class ExamModule {}
