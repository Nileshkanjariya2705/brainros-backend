import { Injectable, BadRequestException } from '@nestjs/common';
import { BlueprintRule } from '@prisma/client';

export interface ResolvedRuleRequirement {
  ruleId?: string;
  subjectId?: string | null;
  chapterId?: string | null;
  topicId?: string | null;
  subTopicId?: string | null;
  difficultyLevel?: string | null;
  type?: string | null;
  requiredCount: number;
}

@Injectable()
export class BlueprintValidationService {
  /**
   * Validates and resolves all blueprint rules into exact integer counts
   */
  resolveBlueprintRuleCounts(
    totalQuestions: number,
    rules: Partial<BlueprintRule>[],
  ): ResolvedRuleRequirement[] {
    if (!rules || rules.length === 0) {
      throw new BadRequestException(
        'Blueprint has no rules configured. At least one rule is required.',
      );
    }

    // 1. Detect duplicate overlapping rules with identical criteria
    const criteriaSet = new Set<string>();
    for (const rule of rules) {
      const key = `${rule.subjectId || '*'}_${rule.chapterId || '*'}_${rule.topicId || '*'}_${rule.subTopicId || '*'}_${rule.difficultyLevel || '*'}_${rule.type || '*'}`;
      if (criteriaSet.has(key)) {
        throw new BadRequestException(
          `Conflicting duplicate rule detected for criteria: ${key}`,
        );
      }
      criteriaSet.add(key);
    }

    // 2. Separate fixed-count rules and percentage-based rules
    const fixedRules = rules.filter(
      (r) => r.selectionCount && r.selectionCount > 0,
    );
    const percentageRules = rules.filter(
      (r) =>
        (!r.selectionCount || r.selectionCount === 0) &&
        r.selectionPercentage &&
        r.selectionPercentage > 0,
    );

    let fixedTotal = 0;
    for (const fr of fixedRules) {
      fixedTotal += fr.selectionCount!;
    }

    if (fixedTotal > totalQuestions) {
      throw new BadRequestException(
        `Sum of fixed rule counts (${fixedTotal}) exceeds blueprint total questions (${totalQuestions}).`,
      );
    }

    // 3. Resolve percentage rules with Hamilton-Webster Largest Remainder Method
    const remainingForPercentages = totalQuestions - fixedTotal;
    const resolvedPercentageRules: ResolvedRuleRequirement[] = [];

    if (percentageRules.length > 0) {
      const totalPercentage = percentageRules.reduce(
        (sum, r) => sum + (r.selectionPercentage || 0),
        0,
      );

      if (Math.abs(totalPercentage - 100) > 0.01 && fixedRules.length === 0) {
        throw new BadRequestException(
          `Sum of rule percentages must equal 100% (currently ${totalPercentage.toFixed(1)}%).`,
        );
      }

      // Apportionment
      const exactAllocations = percentageRules.map((r) => {
        const exact =
          (r.selectionPercentage! / 100) *
          (fixedRules.length > 0 ? remainingForPercentages : totalQuestions);
        const floor = Math.floor(exact);
        const remainder = exact - floor;
        return {
          rule: r,
          floor,
          remainder,
        };
      });

      const currentAllocated = exactAllocations.reduce(
        (sum, a) => sum + a.floor,
        0,
      );
      const neededRemainder =
        (fixedRules.length > 0 ? remainingForPercentages : totalQuestions) -
        currentAllocated;

      // Sort by descending remainder and distribute left-over units
      exactAllocations.sort((a, b) => b.remainder - a.remainder);
      for (let i = 0; i < neededRemainder; i++) {
        if (i < exactAllocations.length) {
          exactAllocations[i].floor += 1;
        }
      }

      for (const item of exactAllocations) {
        resolvedPercentageRules.push({
          ruleId: item.rule.id,
          subjectId: item.rule.subjectId,
          chapterId: item.rule.chapterId,
          topicId: item.rule.topicId,
          subTopicId: item.rule.subTopicId,
          difficultyLevel: item.rule.difficultyLevel,
          type: item.rule.type,
          requiredCount: item.floor,
        });
      }
    }

    // 4. Combine all resolved requirements
    const combined: ResolvedRuleRequirement[] = [
      ...fixedRules.map((fr) => ({
        ruleId: fr.id,
        subjectId: fr.subjectId,
        chapterId: fr.chapterId,
        topicId: fr.topicId,
        subTopicId: fr.subTopicId,
        difficultyLevel: fr.difficultyLevel,
        type: fr.type,
        requiredCount: fr.selectionCount!,
      })),
      ...resolvedPercentageRules,
    ];

    const grandTotal = combined.reduce((sum, r) => sum + r.requiredCount, 0);
    if (grandTotal !== totalQuestions) {
      throw new BadRequestException(
        `Resolved rule questions (${grandTotal}) does not match blueprint total questions (${totalQuestions}).`,
      );
    }

    return combined;
  }
}
