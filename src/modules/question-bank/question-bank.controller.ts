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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QuestionBankService } from './question-bank.service';
import {
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionFilterDto,
  SubmitQuestionDto,
  RejectQuestionDto,
  ArchiveQuestionDto,
} from './dto/question.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionBankController {
  constructor(private readonly questionBankService: QuestionBankService) {}

  /**
   * Create a new question (DRAFT)
   * POST /questions
   */
  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  createQuestion(
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: { userId: string; roles: string[] },
  ) {
    return this.questionBankService.createQuestion(dto, user.userId);
  }

  /**
   * List questions with filtering, search, and pagination
   * GET /questions
   */
  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  findQuestions(@Query() filter: QuestionFilterDto) {
    return this.questionBankService.findQuestions(filter);
  }

  /**
   * Overall Question Bank Stats
   * GET /questions/stats
   */
  @Get('stats')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getOverallQuestionStats(@Query('examTargetId') examTargetId?: string) {
    return this.questionBankService.getQuestionStats(examTargetId);
  }

  /**
   * Get Question Bank stats for specific exam target
   * GET /questions/stats/:examTargetId
   */
  @Get('stats/:examTargetId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getQuestionStatsByExam(@Param('examTargetId') examTargetId: string) {
    return this.questionBankService.getQuestionStats(examTargetId);
  }

  /**
   * Get single question by ID with full details
   * GET /questions/:id
   */
  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  findQuestionById(@Param('id') id: string) {
    return this.questionBankService.findQuestionById(id);
  }

  /**
   * Get review and audit history for a question
   * GET /questions/:id/history
   */
  @Get(':id/history')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getQuestionHistory(@Param('id') id: string) {
    return this.questionBankService.getQuestionHistory(id);
  }

  /**
   * Get version history lineage of a question
   * GET /questions/:id/versions
   */
  @Get(':id/versions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getQuestionVersions(@Param('id') id: string) {
    return this.questionBankService.getQuestionVersions(id);
  }

  /**
   * Update question (auto-versions if question is APPROVED)
   * PATCH /questions/:id
   */
  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateQuestion(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: { userId: string; roles: string[] },
  ) {
    return this.questionBankService.updateQuestion(id, dto, user.userId, user.roles);
  }

  /**
   * Submit a question for Super Admin review (DRAFT / REJECTED -> SUBMITTED)
   * POST /questions/:id/submit
   */
  @Post(':id/submit')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  submitQuestion(
    @Param('id') id: string,
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.submitQuestion(id, user.userId, dto?.comment);
  }

  /**
   * Super Admin starts review on a submitted question (SUBMITTED -> UNDER_REVIEW)
   * POST /questions/:id/start-review
   */
  @Post(':id/start-review')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  startReview(
    @Param('id') id: string,
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.startReview(id, user.userId, dto?.comment);
  }

  /**
   * Super Admin approves question (UNDER_REVIEW -> APPROVED)
   * POST /questions/:id/approve
   */
  @Post(':id/approve')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  approveQuestion(
    @Param('id') id: string,
    @Body() dto: SubmitQuestionDto,
    @CurrentUser() user: { userId: string; roles: string[] },
  ) {
    return this.questionBankService.approveQuestion(id, user.userId, user.roles, dto?.comment);
  }

  /**
   * Super Admin rejects question with a reason (UNDER_REVIEW -> REJECTED)
   * POST /questions/:id/reject
   */
  @Post(':id/reject')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  rejectQuestion(
    @Param('id') id: string,
    @Body() dto: RejectQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.rejectQuestion(id, user.userId, dto.reason);
  }

  /**
   * Super Admin archives question (APPROVED -> ARCHIVED)
   * POST /questions/:id/archive
   */
  @Post(':id/archive')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  archiveQuestion(
    @Param('id') id: string,
    @Body() dto: ArchiveQuestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.archiveQuestion(id, user.userId, dto?.reason);
  }

  /**
   * Delete or archive question
   * DELETE /questions/:id
   */
  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteQuestion(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.questionBankService.deleteQuestion(id, user.userId);
  }
}
