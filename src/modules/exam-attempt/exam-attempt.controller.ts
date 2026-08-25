import {
  Controller, Get, Post, Put, Patch, Param, Body, UseGuards, Req,
} from '@nestjs/common';

import { ExamAttemptService } from './exam-attempt.service';
import { StartAttemptDto, SaveAnswerDto, BulkSaveAnswersDto, SaveTimeLogDto } from './dto/attempt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('attempts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamAttemptController {
  constructor(private readonly attemptService: ExamAttemptService) {}

  @Post('start')
  @Roles('STUDENT')
  startAttempt(@Body() dto: StartAttemptDto, @CurrentUser() user: any, @Req() req: any) {
    return this.attemptService.startAttempt(dto, user.studentId, req.ip);
  }

  @Put(':id/answer')
  @Roles('STUDENT')
  saveAnswer(
    @Param('id') attemptId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentUser() user: any,
  ) {
    return this.attemptService.saveAnswer(attemptId, dto, user.studentId);
  }

  @Put(':id/answers')
  @Roles('STUDENT')
  bulkSaveAnswers(
    @Param('id') attemptId: string,
    @Body() dto: BulkSaveAnswersDto,
    @CurrentUser() user: any,
  ) {
    return this.attemptService.bulkSaveAnswers(attemptId, dto, user.studentId);
  }

  @Post(':id/time-log')
  @Roles('STUDENT')
  saveTimeLog(
    @Param('id') attemptId: string,
    @Body() dto: SaveTimeLogDto,
    @CurrentUser() user: any,
  ) {
    return this.attemptService.saveTimeLog(attemptId, dto, user.studentId);
  }

  @Post(':id/submit')
  @Roles('STUDENT')
  submitAttempt(@Param('id') attemptId: string, @CurrentUser() user: any) {
    return this.attemptService.submitAttempt(attemptId, user.studentId);
  }

  /**
   * Switch exam language during active attempt (zero answer loss / zero timer reset)
   * PATCH /attempts/:id/language
   */
  @Put(':id/language')
  @Roles('STUDENT')
  switchAttemptLanguagePut(
    @Param('id') attemptId: string,
    @Body('languageId') languageId: string,
    @CurrentUser() user: any,
  ) {
    return this.attemptService.switchAttemptLanguage(attemptId, languageId, user.studentId);
  }

  @Patch(':id/language')
  @Roles('STUDENT')
  switchAttemptLanguagePatch(
    @Param('id') attemptId: string,
    @Body('languageId') languageId: string,
    @CurrentUser() user: any,
  ) {
    return this.attemptService.switchAttemptLanguage(attemptId, languageId, user.studentId);
  }


  @Get(':id/status')
  @Roles('STUDENT')
  getAttemptStatus(@Param('id') attemptId: string, @CurrentUser() user: any) {

    return this.attemptService.getAttemptStatus(attemptId, user.studentId);
  }

  @Get(':id/questions')
  @Roles('STUDENT')
  getAttemptQuestions(@Param('id') attemptId: string, @CurrentUser() user: any) {
    return this.attemptService.getAttemptQuestions(attemptId, user.studentId);
  }

  @Get('my-history')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN', 'PARENT', 'INSTITUTION_ADMIN')
  getMyAttempts(@CurrentUser() user: any) {
    return this.attemptService.getStudentAttempts(user?.studentId, user?.userId);
  }
}
