import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { CompletedExamReportsService } from '../services/completed-exam-reports.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class CompletedExamReportsController {
  constructor(
    private readonly reportsService: CompletedExamReportsService,
  ) {}

  /**
   * List all completed Live Exams (latest first, excluding mock tests).
   * GET /admin/completed-exams
   * GET /super-admin/completed-exams
   */
  @Get(['admin/completed-exams', 'super-admin/completed-exams'])
  async getCompletedLiveExams() {
    const data = await this.reportsService.getCompletedLiveExams();
    return {
      statusCode: HttpStatus.OK,
      message: 'Completed live exams retrieved successfully',
      data,
    };
  }

  /**
   * Get latest completed Live Exam.
   * GET /admin/completed-exams/latest
   * GET /super-admin/completed-exams/latest
   */
  @Get(['admin/completed-exams/latest', 'super-admin/completed-exams/latest'])
  async getLatestCompletedLiveExam() {
    const data = await this.reportsService.getLatestCompletedLiveExam();
    return {
      statusCode: HttpStatus.OK,
      message: 'Latest completed live exam retrieved successfully',
      data,
    };
  }

  /**
   * Get KPI Summary for a specific completed Live Exam.
   * GET /admin/completed-exams/:examId/summary
   * GET /super-admin/completed-exams/:examId/summary
   */
  @Get([
    'admin/completed-exams/:examId/summary',
    'super-admin/completed-exams/:examId/summary',
  ])
  async getLiveExamSummary(@Param('examId') examId: string) {
    const data = await this.reportsService.getLiveExamSummary(examId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Exam summary metrics retrieved successfully',
      data,
    };
  }

  /**
   * Get student attendees list for the selected Live Exam.
   * GET /admin/completed-exams/:examId/attendees
   * GET /super-admin/completed-exams/:examId/attendees
   */
  @Get([
    'admin/completed-exams/:examId/attendees',
    'super-admin/completed-exams/:examId/attendees',
  ])
  async getLiveExamAttendees(
    @Param('examId') examId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.reportsService.getLiveExamAttendees(examId, {
      search,
      status,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return {
      statusCode: HttpStatus.OK,
      message: 'Exam attendees retrieved successfully',
      data,
    };
  }

  /**
   * Pure Read-Only Student Analysis & Question Review for a specific attempt.
   * GET /admin/completed-exams/:examId/attendees/:attemptId/analysis
   * GET /super-admin/completed-exams/:examId/attendees/:attemptId/analysis
   */
  @Get([
    'admin/completed-exams/:examId/attendees/:attemptId/analysis',
    'super-admin/completed-exams/:examId/attendees/:attemptId/analysis',
  ])
  async getStudentAttemptAnalysis(
    @Param('examId') examId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const data = await this.reportsService.getStudentAttemptAnalysis(
      examId,
      attemptId,
      user,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Student attempt analysis retrieved successfully',
      data,
    };
  }

  /**
   * Queue PDF report generation and email delivery via BullMQ.
   * POST /admin/completed-exams/:examId/attempts/:attemptId/send-report
   * POST /super-admin/completed-exams/:examId/attempts/:attemptId/send-report
   */
  @Post([
    'admin/completed-exams/:examId/attempts/:attemptId/send-report',
    'super-admin/completed-exams/:examId/attempts/:attemptId/send-report',
  ])
  async sendStudentReportEmail(
    @Param('examId') examId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const data = await this.reportsService.queueReportEmail(
      examId,
      attemptId,
      user,
    );
    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'Student report email job queued successfully',
      data,
    };
  }

  /**
   * Track email delivery status.
   * GET /admin/completed-exams/:examId/attempts/:attemptId/email-status
   * GET /super-admin/completed-exams/:examId/attempts/:attemptId/email-status
   */
  @Get([
    'admin/completed-exams/:examId/attempts/:attemptId/email-status',
    'super-admin/completed-exams/:examId/attempts/:attemptId/email-status',
  ])
  async getReportEmailStatus(
    @Param('examId') examId: string,
    @Param('attemptId') attemptId: string,
  ) {
    const data = await this.reportsService.getReportEmailStatus(
      examId,
      attemptId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Email status retrieved successfully',
      data,
    };
  }
}
