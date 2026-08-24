import { Module } from '@nestjs/common';
import { ExamAttemptController } from './exam-attempt.controller';
import { ExamAttemptService } from './exam-attempt.service';
import { ExamModule } from '../exam/exam.module';

@Module({
  imports: [ExamModule],
  controllers: [ExamAttemptController],
  providers: [ExamAttemptService],
  exports: [ExamAttemptService],
})
export class ExamAttemptModule {}
