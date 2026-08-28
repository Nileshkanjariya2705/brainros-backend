import { Controller, Get, Param, Query } from '@nestjs/common';
import { ExamService } from '../exam.service';
import { ExamFilterDto } from '../dto/exam.dto';

@Controller('public/exams')
export class PublicExamController {
  constructor(private readonly examService: ExamService) {}

  @Get()
  getPublicExams(@Query() filter: ExamFilterDto) {
    return this.examService.findExams(filter);
  }

  @Get(':id')
  getPublicExamById(@Param('id') id: string) {
    return this.examService.findExamById(id);
  }
}
