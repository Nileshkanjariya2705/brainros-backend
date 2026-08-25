import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { HistoricalDatasetSelectorService } from './historical-dataset-selector.service';
import { HistoricalInterpolationModel } from './historical-interpolation.model';
import { PredictionOutput } from '../interfaces/predicted-rank.interface';

@Injectable()
export class PredictionGeneratorService {
  private readonly logger = new Logger(PredictionGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly datasetSelector: HistoricalDatasetSelectorService,
    private readonly interpolationModel: HistoricalInterpolationModel,
  ) {}

  /**
   * Generate or retrieve predicted rank for an evaluated attempt
   */
  async generatePrediction(
    attemptId: string,
    options: { configVersion?: number; forceRegenerate?: boolean } = {},
  ): Promise<PredictionOutput> {
    const configVersion = options.configVersion || 1;
    const forceRegenerate = options.forceRegenerate || false;

    // Check Redis cache first
    const cacheKey = `attempt:${attemptId}:predicted-rank:v${configVersion}`;
    if (!forceRegenerate) {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        result: true,
        exam: {
          include: { examTarget: true },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt '${attemptId}' not found`);
    }

    if (!attempt.result) {
      throw new NotFoundException(`Attempt '${attemptId}' has no evaluated result yet`);
    }

    const score = attempt.result.totalScore;
    const totalMarks = attempt.exam.totalMarks || 720;
    const examType = attempt.exam.examTarget?.name || 'GENERAL';

    // 1. Select comparable historical datasets
    const historicalDatasets = await this.datasetSelector.selectComparableDatasets({
      examType,
      totalMarks,
      limit: 5,
    });

    // 2. Run prediction model
    const predictionOutput = this.interpolationModel.predict(
      {
        attemptId,
        studentId: attempt.studentId,
        score,
        totalMarks,
        examType,
        examVersionId: attempt.examVersionId || undefined,
        examTitle: attempt.exam.title,
      },
      historicalDatasets,
    );

    // 3. Persist PredictionResult in database
    await this.prisma.predictionResult.upsert({
      where: {
        attemptId_modelVersion_configVersion_datasetVersion: {
          attemptId,
          modelVersion: predictionOutput.modelVersion,
          configVersion,
          datasetVersion: predictionOutput.datasetVersion,
        },
      },
      update: {
        inputScore: predictionOutput.inputScore,
        normalizedScore: predictionOutput.normalizedScore,
        predictedRank: predictionOutput.predictedRank ?? null,
        predictedRankMin: predictionOutput.predictedRankMin ?? null,
        predictedRankMax: predictionOutput.predictedRankMax ?? null,
        confidence: predictionOutput.confidence ?? null,
        confidenceScore: predictionOutput.confidenceScore ?? null,
        percentileEstimate: predictionOutput.percentileEstimate ?? null,
        historicalExamCount: predictionOutput.historicalExamCount,
        datasetSize: predictionOutput.datasetSize,
        status: predictionOutput.status as any,
        unavailableReason: predictionOutput.unavailableReason ?? null,
        explanation: predictionOutput.explanation as any,
        generatedAt: new Date(),
      },
      create: {
        attemptId,
        examVersionId: attempt.examVersionId || null,
        modelCode: predictionOutput.modelCode,
        modelVersion: predictionOutput.modelVersion,
        configVersion,
        datasetVersion: predictionOutput.datasetVersion,
        inputScore: predictionOutput.inputScore,
        normalizedScore: predictionOutput.normalizedScore,
        predictedRank: predictionOutput.predictedRank ?? null,
        predictedRankMin: predictionOutput.predictedRankMin ?? null,
        predictedRankMax: predictionOutput.predictedRankMax ?? null,
        confidence: predictionOutput.confidence ?? null,
        confidenceScore: predictionOutput.confidenceScore ?? null,
        percentileEstimate: predictionOutput.percentileEstimate ?? null,
        historicalExamCount: predictionOutput.historicalExamCount,
        datasetSize: predictionOutput.datasetSize,
        status: predictionOutput.status as any,
        unavailableReason: predictionOutput.unavailableReason ?? null,
        explanation: predictionOutput.explanation as any,
        generatedAt: new Date(),
      },
    });

    // 4. Cache in Redis
    await this.redisService.set(cacheKey, JSON.stringify(predictionOutput), 3600); // 1 hour TTL

    this.logger.log(
      `Generated prediction for attempt '${attemptId}': Rank ${predictionOutput.predictedRank} (Range: ${predictionOutput.predictedRankMin}-${predictionOutput.predictedRankMax}, Confidence: ${predictionOutput.confidence})`,
    );

    return predictionOutput;
  }
}
