import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TimeAnalysisService } from '../services/time-analysis.service';
import { RecalculateTimeAnalysisDto } from '../dto/time-tracking.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('attempts/:attemptId/analysis/time')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TimeAnalysisController {
  constructor(private readonly timeAnalysisService: TimeAnalysisService) {}

  /**
   * Get full time analysis report
   */
  @Get()
  getTimeAnalysis(
    @Param('attemptId') attemptId: string,
    @Query('version') version?: number,
  ) {
    return this.timeAnalysisService.generateTimeAnalysis(
      attemptId,
      version ? Number(version) : 1,
    );
  }

  /**
   * Get compact time summary
   */
  @Get('summary')
  getTimeSummary(@Param('attemptId') attemptId: string) {
    return this.timeAnalysisService.getTimeSummary(attemptId);
  }

  /**
   * Get timing for a specific question
   */
  @Get('questions/:questionId')
  getQuestionTiming(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
  ) {
    return this.timeAnalysisService.getQuestionTiming(attemptId, questionId);
  }

  /**
   * Get subject-wise timing breakdown
   */
  @Get('subjects')
  getSubjectTiming(@Param('attemptId') attemptId: string) {
    return this.timeAnalysisService.getSubjectTiming(attemptId);
  }

  /**
   * Get chapter-wise timing breakdown
   */
  @Get('chapters')
  getChapterTiming(@Param('attemptId') attemptId: string) {
    return this.timeAnalysisService.getChapterTiming(attemptId);
  }

  /**
   * Recalculate time analysis from raw logs (internal/admin)
   */
  @Post('recalculate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  recalculateTimeAnalysis(
    @Param('attemptId') attemptId: string,
    @Body() dto: RecalculateTimeAnalysisDto,
  ) {
    return this.timeAnalysisService.recalculateTimeAnalysis(
      attemptId,
      dto.analysisVersion || 1,
    );
  }
}
