import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PredictionGeneratorService } from './prediction-generator.service';

@Injectable()
export class PredictionQueryService {
  private readonly logger = new Logger(PredictionQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: PredictionGeneratorService,
  ) {}

  /**
   * Get predicted rank for a student's attempt
   */
  async getStudentPrediction(attemptId: string, studentId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        student: true,
        predictionResults: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt '${attemptId}' not found`);
    }

    if (attempt.studentId !== studentId) {
      throw new ForbiddenException('You do not own this attempt');
    }

    // If prediction exists, return it
    if (attempt.predictionResults.length > 0) {
      const pred = attempt.predictionResults[0];
      return {
        attemptId,
        examId: attempt.examId,
        examTitle: attempt.exam.title,
        status: pred.status,
        unavailableReason: pred.unavailableReason,
        prediction:
          pred.status === 'COMPLETED'
            ? {
                rank: pred.predictedRank,
                rankRange: {
                  min: pred.predictedRankMin,
                  max: pred.predictedRankMax,
                },
                percentile: pred.percentileEstimate,
                confidence: pred.confidence,
                confidenceScore: pred.confidenceScore,
                model: pred.modelCode,
                modelVersion: pred.modelVersion,
              }
            : null,
        explanation: pred.explanation,
        generatedAt: pred.generatedAt,
      };
    }

    // Otherwise generate prediction on-the-fly
    const generated = await this.generator.generatePrediction(attemptId);
    return {
      attemptId,
      examId: attempt.examId,
      examTitle: attempt.exam.title,
      status: generated.status,
      unavailableReason: generated.unavailableReason,
      prediction:
        generated.status === 'COMPLETED'
          ? {
              rank: generated.predictedRank,
              rankRange: {
                min: generated.predictedRankMin,
                max: generated.predictedRankMax,
              },
              percentile: generated.percentileEstimate,
              confidence: generated.confidence,
              confidenceScore: generated.confidenceScore,
              model: generated.modelCode,
              modelVersion: generated.modelVersion,
            }
          : null,
      explanation: generated.explanation,
      generatedAt: new Date().toISOString(),
    };
  }
}
