import { Injectable, Logger } from '@nestjs/common';
import {
  StrategySummaryMetrics,
  StrategyMetricItem,
} from '../interfaces/attempt-strategy.interface';

@Injectable()
export class StrategyMetricCalculatorService {
  private readonly logger = new Logger(StrategyMetricCalculatorService.name);

  /**
   * Compute normalized strategy metrics from attempt, exam questions, answers, and time logs
   */
  calculateMetrics(params: {
    attempt: any;
    examQuestions: any[];
    answers: any[];
    timeLogs: any[];
  }): {
    summary: StrategySummaryMetrics;
    metricMap: Map<string, StrategyMetricItem>;
  } {
    const { attempt, examQuestions, answers, timeLogs } = params;
    const exam = attempt.exam;
    const result = attempt.result;

    const totalQuestions = examQuestions.length || 1;
    const totalMaxScore = result?.maxScore ?? exam.totalMarks ?? 100;
    const actualObtainedMarks = result?.totalScore ?? 0;

    const answerMap = new Map(answers.map((a) => [a.examQuestionId, a]));

    // Map time logs
    const questionTimeMap = new Map<string, number>();
    for (const log of timeLogs) {
      const prev = questionTimeMap.get(log.examQuestionId) || 0;
      questionTimeMap.set(log.examQuestionId, prev + (log.timeSpentSeconds || 0));
    }

    const totalTimeAvailableSeconds = (exam.durationMinutes || 60) * 60;
    const benchmarkSeconds = totalQuestions > 0 ? Math.round(totalTimeAvailableSeconds / totalQuestions) : 60;

    let attemptedCount = 0;
    let correctCount = 0;
    let wrongCount = 0;

    let highRiskAttemptCount = 0;
    let highRiskWrongCount = 0;

    let totalNegativeMarksLost = 0;
    let avoidableNegativeMarks = 0;

    let timeHeavyAttemptCount = 0;
    let timeHeavyWrongCount = 0;

    let reviewedQuestionCount = 0;
    let reviewedCorrectCount = 0;
    let reviewedWrongCount = 0;

    for (const eq of examQuestions) {
      const q = eq.question;
      const ans = answerMap.get(eq.id);
      const timeSpent = questionTimeMap.get(eq.id) || 0;

      const negMark = eq.negativeMarks ?? exam.defaultNegativeMarks ?? 1;
      const isHighRiskQuestion =
        q.difficultyLevel === 'HARD' ||
        q.difficultyLevel === 'VERY_HARD' ||
        (exam.defaultNegativeMarks && negMark > exam.defaultNegativeMarks);

      const isAttempted = !!ans && (!!ans.selectedOptionId || ans.numericalAnswer !== null || !!ans.selectedOptions);

      if (ans?.isMarkedForReview) {
        reviewedQuestionCount++;
      }

      if (!isAttempted) {
        continue;
      }

      attemptedCount++;

      if (isHighRiskQuestion) {
        highRiskAttemptCount++;
      }

      if (timeSpent > benchmarkSeconds * 1.5) {
        timeHeavyAttemptCount++;
      }

      const isCorrect = this.isAnswerCorrect(q, ans);

      if (isCorrect) {
        correctCount++;
        if (ans?.isMarkedForReview) {
          reviewedCorrectCount++;
        }
      } else {
        wrongCount++;
        totalNegativeMarksLost += negMark;

        if (ans?.isMarkedForReview) {
          reviewedWrongCount++;
        }

        if (isHighRiskQuestion) {
          highRiskWrongCount++;
          avoidableNegativeMarks += negMark;
        }

        if (timeSpent > benchmarkSeconds * 1.5) {
          timeHeavyWrongCount++;
        }
      }
    }

    const unattemptedCount = Math.max(0, totalQuestions - attemptedCount);
    const attemptedPercentage = Math.round((attemptedCount / totalQuestions) * 10000) / 100;
    const unattemptedPercentage = Math.round((unattemptedCount / totalQuestions) * 10000) / 100;
    const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 10000) / 100 : 0;
    const highRiskAccuracy = highRiskAttemptCount > 0
      ? Math.round(((highRiskAttemptCount - highRiskWrongCount) / highRiskAttemptCount) * 10000) / 100
      : 0;

    const negativeMarkingImpactPercentage = totalMaxScore > 0
      ? Math.round((totalNegativeMarksLost / totalMaxScore) * 10000) / 100
      : 0;

    // Conservative Projected Improvement Model
    const projectedImprovementMarks = Math.round(avoidableNegativeMarks * 100) / 100;
    const projectedScore = Math.round(Math.min(totalMaxScore, actualObtainedMarks + projectedImprovementMarks) * 100) / 100;

    const summary: StrategySummaryMetrics = {
      totalQuestions,
      attemptedCount,
      attemptedPercentage,
      unattemptedCount,
      unattemptedPercentage,
      correctCount,
      wrongCount,
      accuracy,
      highRiskAttemptCount,
      highRiskWrongCount,
      highRiskAccuracy,
      negativeMarksLost: Math.round(totalNegativeMarksLost * 100) / 100,
      avoidableNegativeMarks: Math.round(avoidableNegativeMarks * 100) / 100,
      negativeMarkingImpactPercentage,
      timeHeavyWrongCount,
      timeHeavyAttemptCount,
      reviewedQuestionCount,
      reviewedCorrectCount,
      reviewedWrongCount,
      projectedImprovementMarks,
      projectedScore,
      actualObtainedMarks,
      maxScore: totalMaxScore,
    };

    // Build metric map for rule engine
    const metricMap = new Map<string, StrategyMetricItem>();
    const register = (code: string, value: number, unit: StrategyMetricItem['unit']) => {
      metricMap.set(code, { metricCode: code, value, unit });
    };

    register('ATTEMPTED_COUNT', summary.attemptedCount, 'COUNT');
    register('ATTEMPTED_PERCENTAGE', summary.attemptedPercentage, 'PERCENTAGE');
    register('UNATTEMPTED_COUNT', summary.unattemptedCount, 'COUNT');
    register('UNATTEMPTED_PERCENTAGE', summary.unattemptedPercentage, 'PERCENTAGE');
    register('CORRECT_COUNT', summary.correctCount, 'COUNT');
    register('WRONG_COUNT', summary.wrongCount, 'COUNT');
    register('ACCURACY', summary.accuracy, 'PERCENTAGE');
    register('HIGH_RISK_ATTEMPT_COUNT', summary.highRiskAttemptCount, 'COUNT');
    register('HIGH_RISK_WRONG_COUNT', summary.highRiskWrongCount, 'COUNT');
    register('HIGH_RISK_ACCURACY', summary.highRiskAccuracy, 'PERCENTAGE');
    register('NEGATIVE_MARKS_LOST', summary.negativeMarksLost, 'MARKS');
    register('AVOIDABLE_NEGATIVE_MARKS', summary.avoidableNegativeMarks, 'MARKS');
    register('NEGATIVE_MARKING_IMPACT_PERCENTAGE', summary.negativeMarkingImpactPercentage, 'PERCENTAGE');
    register('TIME_HEAVY_WRONG_COUNT', summary.timeHeavyWrongCount, 'COUNT');
    register('TIME_HEAVY_ATTEMPT_COUNT', summary.timeHeavyAttemptCount, 'COUNT');
    register('REVIEWED_QUESTION_COUNT', summary.reviewedQuestionCount, 'COUNT');
    register('REVIEWED_CORRECT_COUNT', summary.reviewedCorrectCount, 'COUNT');
    register('REVIEWED_WRONG_COUNT', summary.reviewedWrongCount, 'COUNT');
    register('PROJECTED_IMPROVEMENT_MARKS', summary.projectedImprovementMarks, 'MARKS');

    return { summary, metricMap };
  }

  // ── Helper: Check answer correctness ──────────────────────────
  private isAnswerCorrect(question: any, answer: any): boolean {
    const code = question.questionType?.code;
    if (!answer) return false;

    switch (code) {
      case 'SCQ':
      case 'TF':
      case 'AR': {
        if (!answer.selectedOptionId) return false;
        const correctOpt = question.options?.find((o: any) => o.isCorrect);
        return correctOpt ? answer.selectedOptionId === correctOpt.id : false;
      }
      case 'MCQ': {
        const selected = answer.selectedOptions as string[] | null;
        if (!selected || selected.length === 0) return false;
        const correctIds = new Set<string>(
          question.options?.filter((o: any) => o.isCorrect).map((o: any) => o.id) || [],
        );
        const selectedSet = new Set<string>(selected);
        if (correctIds.size !== selectedSet.size) return false;
        for (const id of correctIds) {
          if (!selectedSet.has(id)) return false;
        }
        return true;
      }
      case 'NUM': {
        if (answer.numericalAnswer === null || answer.numericalAnswer === undefined) return false;
        const correctVal = question.correctAnswer;
        if (correctVal === null || correctVal === undefined) return false;
        if (typeof correctVal === 'number') {
          return Math.abs(answer.numericalAnswer - correctVal) < 0.001;
        }
        if (typeof correctVal === 'object' && correctVal.min !== undefined && correctVal.max !== undefined) {
          return answer.numericalAnswer >= correctVal.min && answer.numericalAnswer <= correctVal.max;
        }
        return false;
      }
      default:
        return false;
    }
  }
}
