import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExamAttemptController } from './exam-attempt.controller';
import { ExamAttemptService } from './exam-attempt.service';
import { QuestionShuffleService } from './services/question-shuffle.service';
import { ExamModule } from '../exam/exam.module';
import { ExamSchedulingModule } from '../exam-scheduling/exam-scheduling.module';
import { TimeAnalysisModule } from '../time-analysis/time-analysis.module';
import { ResultModule } from '../result/result.module';
import { EVALUATION_QUEUE_NAME } from '../result/interfaces/result-lifecycle.interface';

import { ActiveAttemptGuard } from './guards/active-attempt.guard';

@Module({
  imports: [
    ExamModule,
    ExamSchedulingModule,
    TimeAnalysisModule,
    ResultModule,
    BullModule.registerQueue({
      name: EVALUATION_QUEUE_NAME,
    }),
  ],
  controllers: [ExamAttemptController],
  providers: [ExamAttemptService, QuestionShuffleService, ActiveAttemptGuard],
  exports: [ExamAttemptService, QuestionShuffleService, ActiveAttemptGuard],
})
export class ExamAttemptModule {}
