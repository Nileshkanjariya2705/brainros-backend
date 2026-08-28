import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller';
import { PublicExamController } from './controllers/public-exam.controller';
import { ExamService } from './exam.service';

@Module({
  controllers: [ExamController, PublicExamController],
  providers: [ExamService],
  exports: [ExamService],
})
export class ExamModule {}
