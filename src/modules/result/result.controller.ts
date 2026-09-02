import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ResultService } from './result.service';
import { ResultAccessService } from './services/result-access.service';
import { ResultReadinessService } from './services/result-readiness.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResultController {
  constructor(
    private readonly resultService: ResultService,
    private readonly resultAccessService: ResultAccessService,
    private readonly readinessService: ResultReadinessService,
  ) {}

  @Post('results/:attemptId/calculate')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  calculateResult(@Param('attemptId') attemptId: string) {
    return this.resultService.calculateResult(attemptId);
  }

  @Post('results/:attemptId/recalculate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  recalculateResult(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
    @Body('evaluationVersion') evaluationVersion?: number,
  ) {
    return this.resultService.recalculateResult(
      attemptId,
      user,
      evaluationVersion || 2,
    );
  }

  /**
   * Result Status & Availability Endpoint.
   * Supports:
   *  GET /results/:attemptId/status
   *  GET /students/me/results/:attemptId/status
   */
  @Get(['results/:attemptId/status', 'students/me/results/:attemptId/status'])
  getAttemptResultStatus(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultAccessService.getResultStatus(user, attemptId);
  }

  /**
   * Deep Result Verification Endpoint for Reconciliation & Observability.
   * Checks durable artifacts (Result, SubjectResult, ChapterResult, Time/Strategy, Rank).
   */
  @Get(['results/:attemptId/verify', 'students/me/results/:attemptId/verify'])
  verifyResult(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.verifyResult(attemptId);
  }

  /**
   * Result Report Endpoint.
   * Pure Read-Only. Never triggers recalculation.
   * Supports:
   *  GET /results/:attemptId
   *  GET /students/me/results/:attemptId
   */
  @Get(['results/:attemptId', 'students/me/results/:attemptId'])
  getResult(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getResult(attemptId, user);
  }

  /**
   * Complete Brainros Analysis Engine Report
   * Includes Overall, Subject, Chapter, Time, Strategy, and Recommendations.
   * Pure Read-Only. Never triggers recalculation.
   * Supports:
   *  GET /results/:attemptId/analysis
   *  GET /students/me/results/:attemptId/analysis
   */
  @Get(['results/:attemptId/analysis', 'students/me/results/:attemptId/analysis'])
  getFullAnalysis(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getFullAnalysis(attemptId, user);
  }

  @Get('results/:attemptId/subjects')
  getSubjectResults(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getSubjectResults(attemptId, user);
  }

  @Get('results/:attemptId/chapters')
  getChapterResults(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getChapterResults(attemptId, user);
  }

  @Get('results/:attemptId/time-analysis')
  getTimeAnalysis(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getTimeAnalysis(attemptId, user);
  }

  @Get('results/:attemptId/strategy')
  getAttemptStrategy(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getAttemptStrategy(attemptId, user);
  }

  @Get('results/:attemptId/recommendations')
  getRecommendations(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getRecommendations(attemptId, user);
  }

  @Get('results/:attemptId/review')
  getAnswerReview(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    return this.resultService.getAnswerReview(attemptId, user);
  }

  /**
   * Admin / Super Admin Exam Result Processing View & Stuck Attempt Detection.
   * GET /admin/exams/:examId/results/processing-status
   * GET /super-admin/exams/:examId/results/processing-status
   */
  @Get([
    'admin/exams/:examId/results/processing-status',
    'super-admin/exams/:examId/results/processing-status',
  ])
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getExamProcessingStatus(@Param('examId') examId: string) {
    const data = await this.readinessService.getExamProcessingDetails(examId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Exam processing status retrieved successfully',
      data,
    };
  }
}
