import { Module } from '@nestjs/common';
import { ExamAttemptController } from './exam-attempt.controller';
import { ExamAttemptService } from './exam-attempt.service';
import { ExamModule } from '../exam/exam.module';
import { ExamSchedulingModule } from '../exam-scheduling/exam-scheduling.module';
import { TimeAnalysisModule } from '../time-analysis/time-analysis.module';
import { ResultModule } from '../result/result.module';

@Module({
  imports: [ExamModule, ExamSchedulingModule, TimeAnalysisModule, ResultModule],
  controllers: [ExamAttemptController],
  providers: [ExamAttemptService],
  exports: [ExamAttemptService],
})
export class ExamAttemptModule {}
