import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PerformanceThresholds,
  DEFAULT_PERFORMANCE_THRESHOLDS,
  PerformanceStatus,
  FullAnalysisReport,
  OverallPerformanceMetrics,
  SubjectAnalyticsItem,
  ChapterAnalyticsItem,
  TimeAnalyticsReport,
  AttemptStrategyReport,
  ActionableRecommendation,
  QuestionTimeExtreme,
  SubjectBenchmarkComparison,
} from '../interfaces/analysis.interface';

@Injectable()
export class AnalysisEngineService {
  private readonly logger = new Logger(AnalysisEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to determine status based on configurable thresholds
   */
  evaluateStatus(
    accuracy: number,
    totalAttempted: number,
    thresholds: PerformanceThresholds,
  ): PerformanceStatus {
    if (totalAttempted === 0) return 'NOT_ATTEMPTED';
    if (accuracy >= thresholds.excellent) return 'EXCELLENT';
    if (accuracy >= thresholds.strong) return 'STRONG';
    if (accuracy >= thresholds.good) return 'GOOD';
    if (accuracy >= thresholds.weak) return 'WEAK';
    return 'CRITICAL';
  }

  /**
   * Format seconds to human-readable string (e.g. "48m 20s", "1h 15m 30s")
   */
  formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
  }

  /**
   * Generate Full Comprehensive Analysis Report for an attempt
   */
  async generateFullAnalysis(attemptId: string): Promise<FullAnalysisReport> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            examTarget: true,
            scoringRules: true,
          },
        },
        result: {
          include: {
            subjectResults: { include: { subject: true } },
            chapterResults: {
              include: { chapter: { include: { subject: true } } },
            },
          },
        },
        answers: {
          include: {
            selectedOption: true,
            examQuestion: {
              include: {
                question: {
                  include: {
                    questionType: true,
                    chapter: { include: { subject: true } },
                    options: true,
                  },
                },
                section: true,
              },
            },
          },
        },
        timeLogs: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt with ID '${attemptId}' not found`);
    }

    if (!attempt.result) {
      throw new NotFoundException(
        `Result has not been calculated yet for attempt '${attemptId}'`,
      );
    }

    const exam = attempt.exam;
    const result = attempt.result;

    // ── 1. Resolve Configurable Performance Thresholds ──────────────────────
    let thresholds = DEFAULT_PERFORMANCE_THRESHOLDS;
    if (
      exam.performanceThresholds &&
      typeof exam.performanceThresholds === 'object'
    ) {
      const custom =
        exam.performanceThresholds as Partial<PerformanceThresholds>;
      thresholds = {
        excellent: custom.excellent ?? DEFAULT_PERFORMANCE_THRESHOLDS.excellent,
        strong: custom.strong ?? DEFAULT_PERFORMANCE_THRESHOLDS.strong,
        good: custom.good ?? DEFAULT_PERFORMANCE_THRESHOLDS.good,
        weak: custom.weak ?? DEFAULT_PERFORMANCE_THRESHOLDS.weak,
      };
    }

    // ── 2. Time Used & Per-Question Analytics ──────────────────────────────
    const startedAt = attempt.startedAt
      ? new Date(attempt.startedAt).getTime()
      : 0;
    const submittedAt = attempt.submittedAt
      ? new Date(attempt.submittedAt).getTime()
      : Date.now();
    const totalTimeUsedSeconds = Math.max(
      0,
      Math.floor((submittedAt - startedAt) / 1000),
    );
    const avgTimePerQuestion =
      result.totalQuestions > 0
        ? Math.round((totalTimeUsedSeconds / result.totalQuestions) * 10) / 10
        : 0;

    // Build map of timeLogs: examQuestionId -> totalSeconds
    const questionTimeMap = new Map<string, number>();
    for (const log of attempt.timeLogs) {
      const prev = questionTimeMap.get(log.examQuestionId) || 0;
      questionTimeMap.set(log.examQuestionId, prev + log.timeSpentSeconds);
    }

    // Fetch all exam questions for complete coverage
    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: exam.id },
      include: {
        question: {
          include: {
            questionType: true,
            chapter: { include: { subject: true } },
            options: true,
          },
        },
        section: true,
      },
    });

    // Classify each question attempt
    let totalNegativeMarksLost = 0;
    let correctTimeSum = 0;
    let correctCountForTime = 0;
    let wrongTimeSum = 0;
    let wrongCountForTime = 0;
    let unattemptedTimeSum = 0;
    let unattemptedCountForTime = 0;

    let rushedCount = 0;
    let optimalPaceCount = 0;
    let overthoughtCount = 0;

    let markedForReviewCount = 0;
    let markedAndAnsweredCount = 0;
    let markedAndCorrectCount = 0;
    let markedAndWrongCount = 0;

    const answerMap = new Map(
      attempt.answers.map((a) => [a.examQuestionId, a]),
    );

    const subjectTimeMap = new Map<string, number>();
    const chapterTimeMap = new Map<string, number>();
    const subjectQuestionCountMap = new Map<string, number>();

    // Fastest & slowest question tracking
    let fastestQ: QuestionTimeExtreme | null = null;
    let slowestQ: QuestionTimeExtreme | null = null;
    let displayOrderCounter = 0;

    for (const eq of examQuestions) {
      const ans = answerMap.get(eq.id);
      const q = eq.question;
      const subjectName =
        eq.section?.name || q.chapter?.subject?.name || 'General';
      const chapterId = q.chapterId;
      const timeSpent =
        questionTimeMap.get(eq.id) || (ans ? avgTimePerQuestion : 0);
      displayOrderCounter++;

      // Accumulate subject and chapter times
      subjectTimeMap.set(
        subjectName,
        (subjectTimeMap.get(subjectName) || 0) + timeSpent,
      );
      subjectQuestionCountMap.set(
        subjectName,
        (subjectQuestionCountMap.get(subjectName) || 0) + 1,
      );
      if (chapterId) {
        chapterTimeMap.set(
          chapterId,
          (chapterTimeMap.get(chapterId) || 0) + timeSpent,
        );
      }

      // Track fastest & slowest attempted questions
      const isAttemptedForTime =
        !!ans &&
        (!!ans.selectedOptionId ||
          ans.numericalAnswer !== null ||
          !!ans.selectedOptions);
      if (isAttemptedForTime && timeSpent > 0) {
        const sectionName =
          eq.section?.name || subjectName;
        const isCorrectForExtreme = this.isAnswerCorrect(q, ans);
        const extremeEntry: QuestionTimeExtreme = {
          questionId: q.id,
          examQuestionId: eq.id,
          displayOrder: eq.displayOrder ?? displayOrderCounter,
          timeSeconds: timeSpent,
          sectionName,
          isCorrect: isCorrectForExtreme,
        };

        if (!fastestQ || timeSpent < fastestQ.timeSeconds) {
          fastestQ = extremeEntry;
        }
        if (!slowestQ || timeSpent > slowestQ.timeSeconds) {
          slowestQ = extremeEntry;
        }
      }

      // Check pacing
      if (
        timeSpent < 15 &&
        ans &&
        (ans.selectedOptionId || ans.numericalAnswer !== null)
      ) {
        rushedCount++;
      } else if (timeSpent > avgTimePerQuestion * 2.5 && timeSpent > 60) {
        overthoughtCount++;
      } else {
        optimalPaceCount++;
      }

      if (ans?.isMarkedForReview) {
        markedForReviewCount++;
      }

      const isAttempted =
        !!ans &&
        (!!ans.selectedOptionId ||
          ans.numericalAnswer !== null ||
          !!ans.selectedOptions);

      if (!isAttempted) {
        unattemptedCountForTime++;
        unattemptedTimeSum += timeSpent;
        continue;
      }

      if (ans?.isMarkedForReview) {
        markedAndAnsweredCount++;
      }

      // Check correctness
      const isCorrect = this.isAnswerCorrect(q, ans);

      if (isCorrect) {
        correctCountForTime++;
        correctTimeSum += timeSpent;
        if (ans?.isMarkedForReview) {
          markedAndCorrectCount++;
        }
      } else {
        wrongCountForTime++;
        wrongTimeSum += timeSpent;
        totalNegativeMarksLost += eq.negativeMarks ?? exam.defaultNegativeMarks;
        if (ans?.isMarkedForReview) {
          markedAndWrongCount++;
        }
      }
    }

    // ── 3. Overall Metrics ─────────────────────────────────────────────────
    const speedAccuracyQuadrant = this.determineQuadrant(
      result.accuracy,
      avgTimePerQuestion,
      (exam.durationMinutes * 60) / exam.totalQuestions,
    );
    const overallStatus = this.evaluateStatus(
      result.accuracy,
      result.correctAnswers + result.wrongAnswers,
      thresholds,
    );
    const potentialMarks = result.totalScore + totalNegativeMarksLost;

    const overall: OverallPerformanceMetrics = {
      totalMarks: result.maxScore,
      obtainedMarks: result.totalScore,
      percentage: result.percentage,
      accuracy: result.accuracy,
      correctCount: result.correctAnswers,
      wrongCount: result.wrongAnswers,
      unattemptedCount: result.unattempted,
      totalQuestions: result.totalQuestions,
      timeUsedSeconds: totalTimeUsedSeconds,
      formattedTimeUsed: this.formatDuration(totalTimeUsedSeconds),
      averageTimePerQuestionSeconds: avgTimePerQuestion,
      negativeMarksLost: Math.round(totalNegativeMarksLost * 100) / 100,
      potentialMarks: Math.round(potentialMarks * 100) / 100,
      overallStatus,
      speedAccuracyQuadrant,
    };

    // ── 4. Subject Analytics ───────────────────────────────────────────────
    const subjectItems: SubjectAnalyticsItem[] = result.subjectResults.map(
      (sr) => {
        const timeSpent = subjectTimeMap.get(sr.subject.name) || 0;
        const srAvgTime =
          sr.totalQuestions > 0
            ? Math.round((timeSpent / sr.totalQuestions) * 10) / 10
            : 0;
        const srPercentage =
          sr.maxScore > 0
            ? Math.round((sr.score / sr.maxScore) * 10000) / 100
            : 0;
        const srStatus = this.evaluateStatus(
          sr.accuracy,
          sr.correctAnswers + sr.wrongAnswers,
          thresholds,
        );

        return {
          subjectId: sr.subjectId,
          subjectName: sr.subject.name,
          totalQuestions: sr.totalQuestions,
          correct: sr.correctAnswers,
          wrong: sr.wrongAnswers,
          unattempted: sr.unattempted,
          score: sr.score,
          maxScore: sr.maxScore,
          accuracy: sr.accuracy,
          percentage: srPercentage,
          timeSpentSeconds: timeSpent,
          avgTimePerQuestionSeconds: srAvgTime,
          status: srStatus,
          isStrongest: false,
          isWeakest: false,
        };
      },
    );

    // Identify strongest & weakest subject
    if (subjectItems.length > 0) {
      let highestAcc = -1;
      let lowestAcc = 999;
      let strongIdx = 0;
      let weakIdx = 0;

      subjectItems.forEach((s, idx) => {
        if (s.accuracy > highestAcc) {
          highestAcc = s.accuracy;
          strongIdx = idx;
        }
        if (s.accuracy < lowestAcc) {
          lowestAcc = s.accuracy;
          weakIdx = idx;
        }
      });

      subjectItems[strongIdx].isStrongest = true;
      if (subjectItems.length > 1) {
        subjectItems[weakIdx].isWeakest = true;
      }
    }

    const strongestSubject = subjectItems.find((s) => s.isStrongest) || null;
    const weakestSubject = subjectItems.find((s) => s.isWeakest) || null;

    // ── 5. Chapter Analytics (with Configurable Thresholds) ────────────────
    const chapterItems: ChapterAnalyticsItem[] = result.chapterResults.map(
      (cr) => {
        const timeSpent = chapterTimeMap.get(cr.chapterId) || 0;
        const crAvgTime =
          cr.totalQuestions > 0
            ? Math.round((timeSpent / cr.totalQuestions) * 10) / 10
            : 0;
        const crPercentage =
          cr.maxScore && cr.maxScore > 0
            ? Math.round((cr.score / cr.maxScore) * 10000) / 100
            : cr.accuracy;

        // Evaluated with configurable thresholds per exam
        const crStatus = this.evaluateStatus(
          cr.accuracy,
          cr.correctAnswers + cr.wrongAnswers,
          thresholds,
        );

        return {
          chapterId: cr.chapterId,
          chapterName: cr.chapter.name,
          subjectId: cr.chapter.subjectId,
          subjectName: cr.chapter.subject.name,
          totalQuestions: cr.totalQuestions,
          correct: cr.correctAnswers,
          wrong: cr.wrongAnswers,
          unattempted: cr.unattempted,
          score: cr.score,
          maxScore:
            cr.maxScore ?? cr.totalQuestions * exam.defaultMarksPerQuestion,
          accuracy: cr.accuracy,
          percentage: crPercentage,
          timeSpentSeconds: timeSpent,
          avgTimePerQuestionSeconds: crAvgTime,
          status: crStatus,
        };
      },
    );

    const masteredChapters = chapterItems.filter(
      (c) => c.status === 'EXCELLENT' || c.status === 'STRONG',
    );
    const revisionNeededChapters = chapterItems.filter(
      (c) => c.status === 'GOOD' || c.status === 'WEAK',
    );
    const criticalFocusChapters = chapterItems.filter(
      (c) => c.status === 'CRITICAL',
    );

    // ── 6. Time Analytics Report ───────────────────────────────────────────
    const timeWastedSeconds = wrongTimeSum + unattemptedTimeSum;

    // Subject benchmark comparisons
    const numSubjects = subjectTimeMap.size || 1;
    const totalExamSeconds = exam.durationMinutes * 60;
    const subjectBenchmarkComparisons: SubjectBenchmarkComparison[] = [];

    for (const [sName, actualSec] of subjectTimeMap.entries()) {
      const subjectQCount = subjectQuestionCountMap.get(sName) || 1;
      const recommendedSec = Math.round(
        (subjectQCount / result.totalQuestions) * totalExamSeconds,
      );
      const deltaPct =
        recommendedSec > 0
          ? Math.round(((actualSec - recommendedSec) / recommendedSec) * 100)
          : 0;

      let observation = `Time allocation for ${sName} is within expected range.`;
      if (deltaPct > 20) {
        observation = `Spent ${deltaPct}% more time on ${sName} than recommended. Consider faster elimination strategies.`;
      } else if (deltaPct < -20) {
        observation = `Spent ${Math.abs(deltaPct)}% less time on ${sName} than recommended. Ensure you are not rushing through this subject.`;
      }

      subjectBenchmarkComparisons.push({
        subjectName: sName,
        actualSeconds: actualSec,
        recommendedSeconds: recommendedSec,
        deltaPercent: deltaPct,
        observation,
      });
    }

    const timeAnalysis: TimeAnalyticsReport = {
      totalExamDurationMinutes: exam.durationMinutes,
      totalTimeUsedSeconds,
      timeRemainingSeconds: Math.max(
        0,
        exam.durationMinutes * 60 - totalTimeUsedSeconds,
      ),
      averageTimePerQuestionSeconds: avgTimePerQuestion,
      timeOnCorrectQuestionsSeconds: correctTimeSum,
      avgTimeOnCorrectSeconds:
        correctCountForTime > 0
          ? Math.round(correctTimeSum / correctCountForTime)
          : 0,
      timeOnWrongQuestionsSeconds: wrongTimeSum,
      avgTimeOnWrongSeconds:
        wrongCountForTime > 0
          ? Math.round(wrongTimeSum / wrongCountForTime)
          : 0,
      timeOnUnattemptedQuestionsSeconds: unattemptedTimeSum,
      avgTimeOnUnattemptedSeconds:
        unattemptedCountForTime > 0
          ? Math.round(unattemptedTimeSum / unattemptedCountForTime)
          : 0,
      timeWastedSeconds,
      fastestQuestion: fastestQ,
      slowestQuestion: slowestQ,
      pacingMetrics: {
        rushedCount,
        optimalPaceCount,
        overthoughtCount,
      },
      subjectTimeDistribution: Array.from(subjectTimeMap.entries()).map(
        ([name, seconds]) => ({
          subjectName: name,
          timeSpentSeconds: seconds,
          percentageOfTotalTime:
            totalTimeUsedSeconds > 0
              ? Math.round((seconds / totalTimeUsedSeconds) * 100)
              : 0,
        }),
      ),
      subjectBenchmarkComparisons,
    };

    // ── 7. Attempt Strategy Report ─────────────────────────────────────────
    const attemptRatio =
      result.totalQuestions > 0
        ? Math.round(
            ((result.correctAnswers + result.wrongAnswers) /
              result.totalQuestions) *
              100,
          )
        : 0;

    const strategicTakeaways: string[] = [];
    if (totalNegativeMarksLost >= 8) {
      strategicTakeaways.push(
        `High negative marking penalty: You lost ${totalNegativeMarksLost} marks due to wrong attempts.`,
      );
    }
    if (rushedCount >= 5) {
      strategicTakeaways.push(
        `${rushedCount} questions were answered in under 15 seconds. Ensure you read all options carefully.`,
      );
    }
    if (overthoughtCount >= 4) {
      strategicTakeaways.push(
        `${overthoughtCount} questions took over 2.5x the average time. Practice strategic skipping.`,
      );
    }
    if (
      markedAndCorrectCount > markedAndWrongCount &&
      markedForReviewCount > 0
    ) {
      strategicTakeaways.push(
        `Reviewing marked questions proved beneficial: ${markedAndCorrectCount} of ${markedAndAnsweredCount} marked questions were correct.`,
      );
    }
    if (strategicTakeaways.length === 0) {
      strategicTakeaways.push(
        'Balanced attempt pattern observed with steady pacing and good accuracy.',
      );
    }

    // Over-attempting & under-attempting detection
    const accuracy = result.accuracy;
    const wrongRatio =
      result.correctAnswers + result.wrongAnswers > 0
        ? (result.wrongAnswers / (result.correctAnswers + result.wrongAnswers)) *
          100
        : 0;
    const unattemptedRatio =
      result.totalQuestions > 0
        ? (result.unattempted / result.totalQuestions) * 100
        : 0;

    let overAttemptingWarning: string | null = null;
    if (wrongRatio > 40 && result.wrongAnswers >= 10) {
      overAttemptingWarning = `Over-attempting detected: ${result.wrongAnswers} wrong answers (${Math.round(wrongRatio)}% error rate). You attempted high-risk questions without sufficient confidence, losing ${Math.round(totalNegativeMarksLost)} marks to negative marking.`;
    }

    let underAttemptingWarning: string | null = null;
    if (unattemptedRatio > 30 && result.unattempted >= 15) {
      underAttemptingWarning = `Under-attempting detected: ${result.unattempted} questions (${Math.round(unattemptedRatio)}%) were left unanswered. Some of these may have been easy/medium difficulty questions worth attempting.`;
    }

    const potentialScoreGainMessage =
      totalNegativeMarksLost >= 4
        ? `Score could improve by ~${Math.round(totalNegativeMarksLost)} marks by eliminating low-confidence wrong guesses. Your potential score without negative marking: ${Math.round(result.totalScore + totalNegativeMarksLost)}/${result.maxScore}.`
        : `Good negative marking discipline. Only ${Math.round(totalNegativeMarksLost)} marks lost to wrong attempts.`;

    const attemptStrategy: AttemptStrategyReport = {
      negativeMarkingPenalty: totalNegativeMarksLost,
      marksLostToGuessing: totalNegativeMarksLost,
      scoreWithoutNegativeMarking: result.totalScore + totalNegativeMarksLost,
      reviewBehavior: {
        markedForReviewCount,
        markedAndAnsweredCount,
        markedAndCorrectCount,
        markedAndWrongCount,
      },
      attemptRatio,
      accuracyVsSpeedProfile: speedAccuracyQuadrant.replace(/_/g, ' '),
      strategicTakeaways,
      overAttemptingWarning,
      underAttemptingWarning,
      potentialScoreGainMessage,
    };

    // ── 8. Actionable Personalized Recommendations ────────────────────────
    const recommendations: ActionableRecommendation[] =
      this.generateRecommendations({
        criticalFocusChapters,
        revisionNeededChapters,
        weakestSubject,
        totalNegativeMarksLost,
        timeAnalysis,
        examTargetName: exam.examTarget.name,
        defaultMarks: exam.defaultMarksPerQuestion,
      });

    return {
      attemptId,
      examId: exam.id,
      examTitle: exam.title,
      examTargetName: exam.examTarget.name,
      calculatedAt: result.calculatedAt,
      thresholdsUsed: thresholds,
      overall,
      subjects: {
        items: subjectItems,
        strongestSubject,
        weakestSubject,
      },
      chapters: {
        items: chapterItems,
        mastered: masteredChapters,
        revisionNeeded: revisionNeededChapters,
        criticalFocus: criticalFocusChapters,
      },
      timeAnalysis,
      attemptStrategy,
      recommendations,
    };
  }

  // ── Helper: Evaluate answer correctness ─────────────────────────────────
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
          question.options
            ?.filter((o: any) => o.isCorrect)
            .map((o: any) => o.id) || [],
        );
        const selectedSet = new Set<string>(selected);
        if (correctIds.size !== selectedSet.size) return false;
        for (const id of correctIds) {
          if (!selectedSet.has(id)) return false;
        }
        return true;
      }
      case 'NUM': {
        if (
          answer.numericalAnswer === null ||
          answer.numericalAnswer === undefined
        )
          return false;
        const correctVal = question.correctAnswer;
        if (correctVal === null || correctVal === undefined) return false;
        if (typeof correctVal === 'number') {
          return Math.abs(answer.numericalAnswer - correctVal) < 0.001;
        }
        if (
          typeof correctVal === 'object' &&
          correctVal.min !== undefined &&
          correctVal.max !== undefined
        ) {
          return (
            answer.numericalAnswer >= correctVal.min &&
            answer.numericalAnswer <= correctVal.max
          );
        }
        return false;
      }
      default:
        return false;
    }
  }

  // ── Helper: Determine speed-accuracy quadrant ───────────────────────────
  private determineQuadrant(
    accuracy: number,
    avgTime: number,
    benchmarkTime: number,
  ):
    | 'FAST_AND_ACCURATE'
    | 'SLOW_AND_ACCURATE'
    | 'RUSHED_AND_INACCURATE'
    | 'SLOW_AND_STRUGGLING' {
    const isAccurate = accuracy >= 70;
    const isFast = avgTime <= benchmarkTime;

    if (isAccurate && isFast) return 'FAST_AND_ACCURATE';
    if (isAccurate && !isFast) return 'SLOW_AND_ACCURATE';
    if (!isAccurate && isFast) return 'RUSHED_AND_INACCURATE';
    return 'SLOW_AND_STRUGGLING';
  }

  // ── Helper: Generate prioritized actionable recommendations ─────────────
  private generateRecommendations(params: {
    criticalFocusChapters: ChapterAnalyticsItem[];
    revisionNeededChapters: ChapterAnalyticsItem[];
    weakestSubject: SubjectAnalyticsItem | null;
    totalNegativeMarksLost: number;
    timeAnalysis: TimeAnalyticsReport;
    examTargetName: string;
    defaultMarks: number;
  }): ActionableRecommendation[] {
    const recs: ActionableRecommendation[] = [];
    let idCounter = 1;

    // 1. Critical chapters (High impact)
    for (const chap of params.criticalFocusChapters.slice(0, 3)) {
      const potentialGain =
        (chap.wrong + chap.unattempted) * params.defaultMarks;
      recs.push({
        id: `rec-${idCounter++}`,
        category: 'CHAPTER_REVISION',
        priority: 'HIGH',
        title: `Master ${chap.chapterName} (${chap.subjectName})`,
        description: `Accuracy is currently ${chap.accuracy}% with ${chap.wrong} wrong answer(s). Immediate conceptual revision required.`,
        impactScore: potentialGain,
        actionStep: `Solve 25+ practice problems from ${chap.chapterName} focusing on core formulas and high-yield questions.`,
      });
    }

    // 2. Negative marking reduction
    if (params.totalNegativeMarksLost >= 4) {
      recs.push({
        id: `rec-${idCounter++}`,
        category: 'NEGATIVE_MARKING',
        priority: params.totalNegativeMarksLost >= 8 ? 'HIGH' : 'MEDIUM',
        title: `Curtail Uncalculated Guessing (−${params.totalNegativeMarksLost} Marks)`,
        description: `You lost ${params.totalNegativeMarksLost} marks to negative penalty. Eliminating blind guesses will instantly boost your net score.`,
        impactScore: params.totalNegativeMarksLost,
        actionStep: `Apply the 50-50 elimination rule: Only attempt questions where you can eliminate at least 2 options with certainty.`,
      });
    }

    // 3. Time management / pacing advice
    if (
      params.timeAnalysis.avgTimeOnWrongSeconds >
        params.timeAnalysis.avgTimeOnCorrectSeconds * 1.5 &&
      params.timeAnalysis.avgTimeOnWrongSeconds > 60
    ) {
      recs.push({
        id: `rec-${idCounter++}`,
        category: 'TIME_MANAGEMENT',
        priority: 'MEDIUM',
        title: `Optimize Time on Difficult Questions`,
        description: `You spent an average of ${params.timeAnalysis.avgTimeOnWrongSeconds}s on wrong answers vs ${params.timeAnalysis.avgTimeOnCorrectSeconds}s on correct answers.`,
        impactScore: 6,
        actionStep: `Set a 90-second cut-off: If you cannot find a clear approach within 90 seconds, mark for review and move on.`,
      });
    }

    // 4. Weakest subject intervention
    if (params.weakestSubject && params.weakestSubject.accuracy < 60) {
      recs.push({
        id: `rec-${idCounter++}`,
        category: 'ATTEMPT_STRATEGY',
        priority: 'MEDIUM',
        title: `Boost ${params.weakestSubject.subjectName} Foundation`,
        description: `${params.weakestSubject.subjectName} is your lowest-scoring subject at ${params.weakestSubject.accuracy}% accuracy (${params.weakestSubject.score}/${params.weakestSubject.maxScore} marks).`,
        impactScore: 12,
        actionStep: `Dedicate 45 minutes daily to ${params.weakestSubject.subjectName} chapter summaries and standard mock problems.`,
      });
    }

    // 5. Revision needed chapters (Medium / Low impact)
    for (const chap of params.revisionNeededChapters.slice(0, 2)) {
      recs.push({
        id: `rec-${idCounter++}`,
        category: 'CHAPTER_REVISION',
        priority: 'LOW',
        title: `Polish ${chap.chapterName} (${chap.accuracy}%)`,
        description: `Good foundation, but accuracy can be pushed from ${chap.accuracy}% to 90%+ with targeted question drills.`,
        impactScore: chap.wrong * params.defaultMarks,
        actionStep: `Review incorrect questions from this test and note down mistake patterns in your revision notebook.`,
      });
    }

    return recs;
  }
}
