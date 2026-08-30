import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HistoricalDatasetService } from '../services/historical-dataset.service';
import { PredictionEvaluationService } from '../services/prediction-evaluation.service';
import {
  CreateHistoricalExamDto,
  ImportHistoricalDatasetDto,
} from '../dto/predicted-rank.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('prediction')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminPredictedRankController {
  constructor(
    private readonly historicalService: HistoricalDatasetService,
    private readonly evaluationService: PredictionEvaluationService,
  ) {}

  /**
   * Create a new Historical Exam
   */
  @Post('historical-exams')
  @Roles('ADMIN', 'SUPER_ADMIN')
  createHistoricalExam(@Body() dto: CreateHistoricalExamDto) {
    return this.historicalService.createHistoricalExam(dto);
  }

  /**
   * List all historical exams
   */
  @Get('historical-exams')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getHistoricalExams(@Query('examType') examType?: string) {
    return this.historicalService.getHistoricalExams(examType);
  }

  /**
   * Get historical exam details with score ranges
   */
  @Get('historical-exams/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getHistoricalExamById(@Param('id') id: string) {
    return this.historicalService.getHistoricalExamById(id);
  }

  /**
   * Ingest score ranges for historical exam
   */
  @Post('historical-exams/:id/dataset')
  @Roles('ADMIN', 'SUPER_ADMIN')
  importDataset(
    @Param('id') id: string,
    @Body() dto: ImportHistoricalDatasetDto,
  ) {
    return this.historicalService.importScoreRanges(id, dto);
  }

  /**
   * Run dataset quality validation
   */
  @Post('historical-exams/:id/validate')
  @Roles('ADMIN', 'SUPER_ADMIN')
  validateDataset(@Param('id') id: string) {
    return this.historicalService.validateDataset(id);
  }

  /**
   * Evaluate predictions vs actual ranks for an exam
   */
  @Post('evaluations/exam/:examId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  evaluateExamPredictions(@Param('examId') examId: string) {
    return this.evaluationService.evaluatePredictionsForExam(examId);
  }

  /**
   * Get model accuracy summary metrics (MAE, Median AE, Range Coverage)
   */
  @Get('evaluation/summary')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getModelSummary(@Query('modelVersion') modelVersion?: string) {
    return this.evaluationService.getModelAccuracySummary(
      modelVersion || 'v1.0.0',
    );
  }
}
