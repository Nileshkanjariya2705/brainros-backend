import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ExamLifecycleService } from '../services/exam-lifecycle.service';
import { ExamScheduleService } from '../services/exam-schedule.service';
import { ExamAccessService } from '../services/exam-access.service';
import { ScheduleExamDto, RescheduleExamDto } from '../dto/schedule-exam.dto';
import { CancelExamDto, ActionReasonDto } from '../dto/lifecycle-action.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamSchedulingController {
  constructor(
    private readonly lifecycleService: ExamLifecycleService,
    private readonly scheduleService: ExamScheduleService,
    private readonly accessService: ExamAccessService,
  ) {}

  @Post('exams/:examId/submit')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async submitExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ActionReasonDto,
  ) {
    const data = await this.lifecycleService.submitExam(examId, userId, dto?.comment);
    return {
      statusCode: 200,
      message: 'Exam submitted for Super Admin approval successfully',
      data,
    };
  }

  @Post('exams/:examId/approve')
  @Roles('SUPER_ADMIN')
  async approveExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ActionReasonDto,
  ) {
    const data = await this.lifecycleService.approveExam(examId, userId, dto?.comment);
    return {
      statusCode: 200,
      message: 'Exam approved by Super Admin. Ready for scheduling.',
      data,
    };
  }

  @Post('exams/:examId/schedule')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async scheduleExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ScheduleExamDto,
  ) {
    const data = await this.scheduleService.scheduleExam(examId, dto, userId);
    return {
      statusCode: 201,
      message: 'Exam scheduled successfully. Requires Super Admin activation before live start.',
      data,
    };
  }

  @Patch('exam-schedules/:scheduleId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async rescheduleExam(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RescheduleExamDto,
  ) {
    const data = await this.scheduleService.rescheduleExam(scheduleId, dto, userId);
    return {
      statusCode: 200,
      message: 'Exam schedule updated successfully',
      data,
    };
  }

  @Post('exam-schedules/:scheduleId/activate')
  @Roles('SUPER_ADMIN')
  async activateExam(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.scheduleService.activateExam(scheduleId, userId);
    return {
      statusCode: 200,
      message: data.message,
      data: data.schedule,
    };
  }

  @Post('exams/:examId/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async cancelExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CancelExamDto,
  ) {
    const data = await this.lifecycleService.cancelExam(examId, userId, dto?.reason);
    return {
      statusCode: 200,
      message: 'Exam cancelled successfully',
      data,
    };
  }

  @Get('exams/:examId/lifecycle')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  async getExamLifecycleHistory(@Param('examId', ParseUUIDPipe) examId: string) {
    const data = await this.lifecycleService.getExamLifecycleHistory(examId);
    return {
      statusCode: 200,
      message: 'Exam lifecycle audit history fetched successfully',
      data,
    };
  }

  @Get('exams/:examId/schedule')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  async getExamSchedule(@Param('examId', ParseUUIDPipe) examId: string) {
    const data = await this.scheduleService.getExamSchedule(examId);
    return {
      statusCode: 200,
      message: 'Exam schedule fetched successfully',
      data,
    };
  }

  @Get('exams/:examId/access-check')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async checkExamAccess(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.accessService.validateStudentAccess(examId, userId);
    return {
      statusCode: 200,
      message: 'Student access authorized for active live window',
      data,
    };
  }
}
