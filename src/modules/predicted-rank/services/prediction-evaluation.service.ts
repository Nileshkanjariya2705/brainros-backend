import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelAccuracySummary } from '../interfaces/predicted-rank.interface';

@Injectable()
export class PredictionEvaluationService {
  private readonly logger = new Logger(PredictionEvaluationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluate predictions for an exam population against official ranks
   */
  async evaluatePredictionsForExam(examId: string) {
    const candidateRanks = await this.prisma.candidateRank.findMany({
      where: {
        rankType: 'OVERALL',
        attempt: { examId },
      },
      include: {
        attempt: {
          include: {
            predictionResults: {
              where: { status: 'COMPLETED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    let evaluatedCount = 0;

    for (const cRank of candidateRanks) {
      const pred = cRank.attempt.predictionResults[0];
      if (!pred || !pred.predictedRank) continue;

      const actualRank = cRank.rank;
      const predictedRank = pred.predictedRank;
      const absoluteError = Math.abs(actualRank - predictedRank);
      const relativeError = actualRank > 0 ? Math.round((absoluteError / actualRank) * 10000) / 100 : 0;
      const withinPredictedRange =
        pred.predictedRankMin !== null && pred.predictedRankMax !== null
          ? actualRank >= pred.predictedRankMin && actualRank <= pred.predictedRankMax
          : false;

      // Upsert evaluation record
      await this.prisma.predictionEvaluation.create({
        data: {
          predictionResultId: pred.id,
          actualRank,
          predictedRank,
          absoluteError,
          relativeError,
          withinPredictedRange,
        },
      });

      evaluatedCount++;
    }

    this.logger.log(`Evaluated ${evaluatedCount} predictions against actual ranks for exam '${examId}'`);
    return { evaluatedCount };
  }

  /**
   * Aggregate model performance metrics (MAE, Median AE, Range Coverage)
   */
  async getModelAccuracySummary(modelVersion: string = 'v1.0.0'): Promise<ModelAccuracySummary> {
    const evaluations = await this.prisma.predictionEvaluation.findMany({
      where: {
        predictionResult: { modelVersion },
      },
    });

    if (evaluations.length === 0) {
      return {
        modelCode: 'HISTORICAL_INTERPOLATION',
        modelVersion,
        totalEvaluations: 0,
        meanAbsoluteError: 0,
        medianAbsoluteError: 0,
        meanRelativeError: 0,
        rangeCoveragePercentage: 0,
        withinRangeCount: 0,
      };
    }

    const absErrors = evaluations.map((e) => e.absoluteError).sort((a, b) => a - b);
    const relErrors = evaluations.map((e) => e.relativeError);
    const withinCount = evaluations.filter((e) => e.withinPredictedRange).length;

    const sumAbs = absErrors.reduce((a, b) => a + b, 0);
    const sumRel = relErrors.reduce((a, b) => a + b, 0);
    const mid = Math.floor(absErrors.length / 2);
    const medianAbs = absErrors.length % 2 !== 0 ? absErrors[mid] : (absErrors[mid - 1] + absErrors[mid]) / 2;

    return {
      modelCode: 'HISTORICAL_INTERPOLATION',
      modelVersion,
      totalEvaluations: evaluations.length,
      meanAbsoluteError: Math.round((sumAbs / evaluations.length) * 10) / 10,
      medianAbsoluteError: Math.round(medianAbs * 10) / 10,
      meanRelativeError: Math.round((sumRel / evaluations.length) * 100) / 100,
      rangeCoveragePercentage: Math.round((withinCount / evaluations.length) * 10000) / 100,
      withinRangeCount: withinCount,
    };
  }
}
