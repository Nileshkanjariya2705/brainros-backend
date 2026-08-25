import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResolvedRuleRequirement } from './blueprint-validation.service';
import { ExamRandomizationService } from './exam-randomization.service';

export interface PoolCheckReportItem {
  ruleIndex: number;
  subjectId?: string | null;
  chapterId?: string | null;
  difficultyLevel?: string | null;
  type?: string | null;
  required: number;
  available: number;
  isSatisfied: boolean;
}

export interface PoolValidationResult {
  isValid: boolean;
  totalRequired: number;
  totalAvailableEligible: number;
  ruleReports: PoolCheckReportItem[];
}

@Injectable()
export class QuestionPoolService {
  private readonly logger = new Logger(QuestionPoolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly randomizationService: ExamRandomizationService,
  ) {}

  /**
   * Pre-flight pool validation checking if question bank has enough approved questions
   */
  async validatePoolAvailability(
    resolvedRules: ResolvedRuleRequirement[],
    requiredLanguageIds?: string[],
  ): Promise<PoolValidationResult> {
    const reports: PoolCheckReportItem[] = [];
    let allValid = true;

    for (let i = 0; i < resolvedRules.length; i++) {
      const rule = resolvedRules[i];
      const whereClause = this.buildRuleWhereClause(rule, requiredLanguageIds);

      const availableCount = await this.prisma.question.count({
        where: whereClause,
      });

      const isSatisfied = availableCount >= rule.requiredCount;
      if (!isSatisfied) {
        allValid = false;
      }

      reports.push({
        ruleIndex: i + 1,
        subjectId: rule.subjectId,
        chapterId: rule.chapterId,
        difficultyLevel: rule.difficultyLevel,
        type: rule.type,
        required: rule.requiredCount,
        available: availableCount,
        isSatisfied,
      });
    }

    const totalRequired = resolvedRules.reduce((sum, r) => sum + r.requiredCount, 0);
    const totalAvailableEligible = await this.prisma.question.count({
      where: {
        status: 'APPROVED',
        isActive: true,
      },
    });

    return {
      isValid: allValid,
      totalRequired,
      totalAvailableEligible,
      ruleReports: reports,
    };
  }

  /**
   * Selects the exact set of distinct questions matching all blueprint rules
   */
  async selectQuestionsForBlueprint(
    resolvedRules: ResolvedRuleRequirement[],
    generationSeed: string,
    requiredLanguageIds?: string[],
  ) {
    const selectedQuestionIds = new Set<string>();
    const selectedQuestions: any[] = [];

    for (let i = 0; i < resolvedRules.length; i++) {
      const rule = resolvedRules[i];
      const whereClause = this.buildRuleWhereClause(rule, requiredLanguageIds);

      // Exclude already selected questions in earlier rules to ensure distinctness
      const whereWithExclusions = {
        ...whereClause,
        id: { notIn: Array.from(selectedQuestionIds) },
      };

      // Retrieve eligible question IDs
      const eligibleQuestions = await this.prisma.question.findMany({
        where: whereWithExclusions,
        include: {
          subject: { select: { name: true } },
          options: {
            include: {
              translations: true,
            },
          },
          translations: true,
          answer: true,
          explanation: true,
        },
      });

      if (eligibleQuestions.length < rule.requiredCount) {
        const diffText = rule.difficultyLevel ? ` [Difficulty: ${rule.difficultyLevel}]` : '';
        const typeText = rule.type ? ` [Type: ${rule.type}]` : '';
        throw new BadRequestException(
          `Insufficient question pool for rule #${i + 1}${diffText}${typeText}. Required: ${rule.requiredCount}, Available eligible: ${eligibleQuestions.length}.`,
        );
      }

      // Deterministically shuffle candidate pool using generation seed + rule index
      const ruleSeed = `${generationSeed}_rule_${i}`;
      const shuffledCandidates = this.randomizationService.shuffleArray(eligibleQuestions, ruleSeed);
      const chosenForThisRule = shuffledCandidates.slice(0, rule.requiredCount);

      for (const q of chosenForThisRule) {
        selectedQuestionIds.add(q.id);
        selectedQuestions.push(q);
      }
    }

    return selectedQuestions;
  }

  private buildRuleWhereClause(
    rule: ResolvedRuleRequirement,
    requiredLanguageIds?: string[],
  ): any {
    const where: any = {
      status: 'APPROVED',
      isActive: true,
    };

    if (rule.subjectId) where.subjectId = rule.subjectId;
    if (rule.chapterId) where.chapterId = rule.chapterId;
    if (rule.topicId) where.topicId = rule.topicId;
    if (rule.subTopicId) where.subTopicId = rule.subTopicId;
    if (rule.difficultyLevel) where.difficultyLevel = rule.difficultyLevel;
    if (rule.type) where.type = rule.type;

    // Translation availability filter if requested
    if (requiredLanguageIds && requiredLanguageIds.length > 0) {
      where.translations = {
        some: {
          languageId: { in: requiredLanguageIds },
        },
      };
    }

    return where;
  }
}
