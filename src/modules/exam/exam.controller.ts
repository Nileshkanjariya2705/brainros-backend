import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import {
  CreateExamDto,
  UpdateExamDto,
  GenerateExamQuestionsDto,
  AddExamQuestionsDto,
  ExamFilterDto,
  CreateExamFromTemplateDto,
} from './dto/exam.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('exams')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  // ─── Admin Endpoints ─────────────────────────────────────────

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  createExam(@Body() dto: CreateExamDto, @CurrentUser() user: any) {
    return this.examService.createExam(dto, user.userId);
  }

  @Post('create-from-template')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createExamFromTemplate(@Body() dto: CreateExamFromTemplateDto, @CurrentUser() user: any) {
    return this.examService.createExamFromTemplate(dto, user.userId);
  }

  @Post('generate-questions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  generateExamQuestions(@Body() dto: GenerateExamQuestionsDto) {
    return this.examService.generateExamQuestions(dto);
  }

  @Post('add-questions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  addExamQuestions(@Body() dto: AddExamQuestionsDto) {
    return this.examService.addExamQuestions(dto);
  }

  @Patch(':id/submit')
  @Roles('ADMIN', 'SUPER_ADMIN')
  submitForApproval(@Param('id') id: string) {
    return this.examService.submitForApproval(id);
  }

  @Patch(':id/approve')
  @Roles('SUPER_ADMIN')
  approveExam(@Param('id') id: string, @CurrentUser() user: any) {
    return this.examService.approveExam(id, user.userId);
  }

  @Patch(':id/activate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  activateExam(@Param('id') id: string) {
    return this.examService.activateExam(id);
  }

  @Patch(':id/complete')
  @Roles('ADMIN', 'SUPER_ADMIN')
  completeExam(@Param('id') id: string) {
    return this.examService.completeExam(id);
  }

  @Patch(':id/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN')
  cancelExam(@Param('id') id: string) {
    return this.examService.cancelExam(id);
  }

  // ─── Common Endpoints ────────────────────────────────────────

  @Get()
  findExams(@Query() filter: ExamFilterDto) {
    return this.examService.findExams(filter);
  }

  @Get('available/:examTargetId')
  getAvailableExams(@Param('examTargetId') examTargetId: string) {
    return this.examService.getAvailableExams(examTargetId);
  }

  @Get(':id/details')
  getExamDetails(@Param('id') id: string, @CurrentUser() user: any) {
    const userId = user?.userId || user?.id || user?.sub;
    return this.examService.getExamDetails(id, userId);
  }

  @Get(':id')
  findExamById(@Param('id') id: string) {
    return this.examService.findExamById(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateExam(@Param('id') id: string, @Body() dto: UpdateExamDto) {
    return this.examService.updateExam(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteExam(@Param('id') id: string) {
    return this.examService.deleteExam(id);
  }
}
