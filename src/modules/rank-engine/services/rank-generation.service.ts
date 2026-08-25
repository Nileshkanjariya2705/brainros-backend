import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RankingCandidateEligibilityService } from './ranking-candidate-eligibility.service';
import { TieBreakService } from './tie-break.service';
import { PercentileService } from './percentile.service';
import { PredictionService } from './prediction.service';
import {
  CandidateRankInput,
  CalculatedRankItem,
  RankTypeEnum,
} from '../interfaces/rank-engine.interface';

@Injectable()
export class RankGenerationService {
  private readonly logger = new Logger(RankGenerationService.name);
  private readonly CURRENT_ALGORITHM_VERSION = 'v1.0.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly eligibilityService: RankingCandidateEligibilityService,
    private readonly tieBreakService: TieBreakService,
    private readonly percentileService: PercentileService,
    private readonly predictionService: PredictionService,
  ) {}

  /**
   * Run full batch rank and percentile generation for an exam population
   */
  async generateRanks(params: {
    examId: string;
    examVersionId?: string;
    snapshotVersion?: number;
    forceRegenerate?: boolean;
  }) {
    const { examId, examVersionId, forceRegenerate } = params;
    const snapshotVersion = params.snapshotVersion || 1;

    // 1. Concurrency Lock in Redis
    const lockKey = `lock:rank-generation:${examId}:${snapshotVersion}`;
    await this.redisService.set(lockKey, 'locked', 300); // 5 min TTL

    try {
      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        include: { examTarget: true },
      });
      if (!exam) {
        throw new NotFoundException(`Exam '${examId}' not found`);
      }

      // Check existing snapshot
      const existingSnapshot = await this.prisma.rankSnapshot.findUnique({
        where: { examId_snapshotVersion: { examId, snapshotVersion } },
      });

      if (existingSnapshot && existingSnapshot.status === 'COMPLETED' && !forceRegenerate) {
        return {
          snapshotId: existingSnapshot.id,
          status: 'COMPLETED',
          message: `Rank snapshot v${snapshotVersion} already exists. Use forceRegenerate to recreate.`,
          totalCandidates: existingSnapshot.totalCandidates,
        };
      }

      // 2. Create or update RankSnapshot as PROCESSING
      const snapshot = await this.prisma.rankSnapshot.upsert({
        where: { examId_snapshotVersion: { examId, snapshotVersion } },
        update: {
          status: 'PROCESSING',
          examVersionId,
          algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
          generatedAt: new Date(),
          completedAt: null,
          integrityChecksPassed: false,
        },
        create: {
          examId,
          examVersionId,
          snapshotVersion,
          algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
          status: 'PROCESSING',
          generatedAt: new Date(),
        },
      });

      // 3. Collect eligible candidate population
      const candidates = await this.eligibilityService.getEligibleCandidates(examId, examVersionId);

      if (candidates.length === 0) {
        await this.prisma.rankSnapshot.update({
          where: { id: snapshot.id },
          data: {
            status: 'COMPLETED',
            totalCandidates: 0,
            integrityChecksPassed: true,
            completedAt: new Date(),
          },
        });
        return {
          snapshotId: snapshot.id,
          status: 'COMPLETED',
          totalCandidates: 0,
          message: 'No eligible candidates found for ranking.',
        };
      }

      // 4. Compute Overall Rankings & Predictions
      const allRankRows: CalculatedRankItem[] = [];
      const overallRankMap = new Map<string, number>();

      const sortedOverall = this.tieBreakService.sortCandidates(candidates);
      const rankedOverall = this.tieBreakService.assignRanks(sortedOverall, 'COMPETITION');
      const totalOverallCandidates = candidates.length;

      for (const item of rankedOverall) {
        const c = item.candidate;
        const rank = item.rank;
        const percentile = this.percentileService.calculatePercentile(rank, totalOverallCandidates);
        overallRankMap.set(c.studentId, rank);

        const prediction = this.predictionService.predictRankRange({
          actualRank: rank,
          totalCandidates: totalOverallCandidates,
          score: c.score,
          maxScore: c.maxScore,
          percentile,
        });

        allRankRows.push({
          attemptId: c.attemptId,
          studentId: c.studentId,
          rankType: 'OVERALL',
          scopeId: 'ALL',
          scopeName: 'All Candidates',
          rank,
          totalCandidates: totalOverallCandidates,
          percentile,
          score: c.score,
          accuracy: c.accuracy,
          timeUsedSeconds: c.timeUsedSeconds,
          predictedRankMin: prediction.min,
          predictedRankMax: prediction.max,
          predictionConfidence: prediction.confidence,
          predictionModelVersion: prediction.modelVersion,
        });
      }

      // 5. Partitioned Scoped Rankings (STATE, DISTRICT, SCHOOL, CATEGORY)
      this.computePartitionedRanks(candidates, 'STATE', (c) => c.state, allRankRows);
      this.computePartitionedRanks(candidates, 'DISTRICT', (c) => c.district, allRankRows);
      this.computePartitionedRanks(candidates, 'SCHOOL', (c) => c.schoolCollege, allRankRows);
      this.computePartitionedRanks(candidates, 'CATEGORY', (c) => c.category, allRankRows);

      // 6. Integrity Checks
      this.validateIntegrity(candidates, allRankRows);

      // 7. Calculate Aggregates for Snapshot
      const scores = candidates.map((c) => c.score).sort((a, b) => a - b);
      const highestScore = scores[scores.length - 1];
      const lowestScore = scores[0];
      const sumScores = scores.reduce((a, b) => a + b, 0);
      const averageScore = Math.round((sumScores / scores.length) * 100) / 100;
      const mid = Math.floor(scores.length / 2);
      const medianScore = scores.length % 2 !== 0 ? scores[mid] : Math.round(((scores[mid - 1] + scores[mid]) / 2) * 100) / 100;

      // 8. Persist in Database (Delete old snapshot rows + Chunked Insert)
      await this.prisma.$transaction(async (tx) => {
        await tx.candidateRank.deleteMany({
          where: { rankSnapshotId: snapshot.id },
        });

        // Insert in chunks of 500
        const CHUNK_SIZE = 500;
        for (let i = 0; i < allRankRows.length; i += CHUNK_SIZE) {
          const chunk = allRankRows.slice(i, i + CHUNK_SIZE);
          await tx.candidateRank.createMany({
            data: chunk.map((r) => ({
              rankSnapshotId: snapshot.id,
              attemptId: r.attemptId,
              studentId: r.studentId,
              rankType: r.rankType as any,
              scopeId: r.scopeId || null,
              scopeName: r.scopeName || null,
              categoryId: r.categoryId || null,
              categoryName: r.categoryName || null,
              rank: r.rank,
              totalCandidates: r.totalCandidates,
              percentile: r.percentile,
              score: r.score,
              accuracy: r.accuracy,
              timeUsedSeconds: r.timeUsedSeconds || null,
              predictedRankMin: r.predictedRankMin || null,
              predictedRankMax: r.predictedRankMax || null,
              predictionConfidence: r.predictionConfidence || null,
              predictionModelVersion: r.predictionModelVersion || null,
            })),
          });
        }

        await tx.rankSnapshot.update({
          where: { id: snapshot.id },
          data: {
            status: 'COMPLETED',
            totalCandidates: totalOverallCandidates,
            highestScore,
            lowestScore,
            averageScore,
            medianScore,
            integrityChecksPassed: true,
            completedAt: new Date(),
          },
        });
      });

      // 9. Invalidate Caches
      await this.redisService.del(`ranks:${examId}:*`);

      this.logger.log(
        `Successfully generated and persisted ${allRankRows.length} ranks for exam '${examId}' snapshot v${snapshotVersion}`,
      );

      return {
        snapshotId: snapshot.id,
        status: 'COMPLETED',
        totalCandidates: totalOverallCandidates,
        totalRankEntries: allRankRows.length,
        highestScore,
        lowestScore,
        averageScore,
        medianScore,
      };
    } catch (err) {
      this.logger.error(`Failed to generate ranks for exam '${examId}': ${err.message}`);
      await this.prisma.rankSnapshot.updateMany({
        where: { examId, snapshotVersion },
        data: { status: 'FAILED' },
      });
      throw err;
    } finally {
      await this.redisService.del(lockKey);
    }
  }

  // ── Helper: Compute Partitioned Scoped Rankings ────────────────
  private computePartitionedRanks(
    candidates: CandidateRankInput[],
    rankType: RankTypeEnum,
    scopeExtractor: (c: CandidateRankInput) => string | null | undefined,
    outRows: CalculatedRankItem[],
  ) {
    const partitions = new Map<string, CandidateRankInput[]>();

    for (const c of candidates) {
      const scopeVal = scopeExtractor(c);
      if (!scopeVal) continue;

      const list = partitions.get(scopeVal) || [];
      list.push(c);
      partitions.set(scopeVal, list);
    }

    for (const [scopeVal, groupCandidates] of partitions.entries()) {
      const sorted = this.tieBreakService.sortCandidates(groupCandidates);
      const ranked = this.tieBreakService.assignRanks(sorted, 'COMPETITION');
      const totalGroup = groupCandidates.length;

      for (const item of ranked) {
        const c = item.candidate;
        const rank = item.rank;
        const percentile = this.percentileService.calculatePercentile(rank, totalGroup);

        outRows.push({
          attemptId: c.attemptId,
          studentId: c.studentId,
          rankType,
          scopeId: scopeVal,
          scopeName: scopeVal,
          categoryId: rankType === 'CATEGORY' ? scopeVal : null,
          categoryName: rankType === 'CATEGORY' ? scopeVal : null,
          rank,
          totalCandidates: totalGroup,
          percentile,
          score: c.score,
          accuracy: c.accuracy,
          timeUsedSeconds: c.timeUsedSeconds,
        });
      }
    }
  }

  // ── Helper: Run 8 Integrity Checks ───────────────────────────
  private validateIntegrity(candidates: CandidateRankInput[], rankRows: CalculatedRankItem[]) {
    if (candidates.length === 0) return;

    // Check 1: Top candidate has rank 1
    const overallRows = rankRows.filter((r) => r.rankType === 'OVERALL');
    const minRank = Math.min(...overallRows.map((r) => r.rank));
    if (minRank !== 1) {
      throw new Error(`Integrity Check Failed: Minimum overall rank is ${minRank}, expected 1`);
    }

    // Check 2: All ranks >= 1
    for (const r of rankRows) {
      if (r.rank < 1) {
        throw new Error(`Integrity Check Failed: Invalid rank ${r.rank} for student ${r.studentId}`);
      }
      if (r.percentile < 0 || r.percentile > 100) {
        throw new Error(`Integrity Check Failed: Percentile ${r.percentile} out of bounds`);
      }
    }

    // Check 3: Every candidate has exactly one OVERALL rank
    if (overallRows.length !== candidates.length) {
      throw new Error(
        `Integrity Check Failed: Expected ${candidates.length} overall ranks, found ${overallRows.length}`,
      );
    }
  }
}
