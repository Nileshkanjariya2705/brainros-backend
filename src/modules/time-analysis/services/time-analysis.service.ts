import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisTimingStore } from '../stores/redis-timing.store';
import { QuestionTimingService } from './question-timing.service';
import {
  DetailedTimeAnalysis,
  QuestionTimingSummary,
  SubjectTimeSummary,
  ChapterTimeSummary,
  CorrectnessTimeSummary,
  DifficultyTimeSummary,
  QuestionTypeTimeSummary,
} from '../interfaces/time-analysis.interface';

@Injectable()
export class TimeAnalysisService {
  private readonly logger = new Logger(TimeAnalysisService.name);
  private readonly CURRENT_ALGORITHM_VERSION = 'v1.0.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly timingStore: RedisTimingStore,
    private readonly questionTimingService: QuestionTimingService,
  ) {}

  /**
   * Generate & Materialize Time Analysis for an attempt.
   * Idempotent per (attemptId, analysisVersion).
   */
  async generateTimeAnalysis(
    attemptId: string,
    analysisVersion: number = 1,
  ): Promise<DetailedTimeAnalysis> {
    // Check Redis cache first
    const cached = await this.timingStore.getCachedAnalysis(
      attemptId,
      analysisVersion,
    );
    if (cached) {
      return cached as DetailedTimeAnalysis;
    }

    // Check DB for existing materialized analysis
    const existing = await this.prisma.timeAnalysis.findUnique({
      where: { attemptId_analysisVersion: { attemptId, analysisVersion } },
    });
    if (existing) {
      const parsed = existing.data as unknown as DetailedTimeAnalysis;
      await this.timingStore.setCachedAnalysis(
        attemptId,
        analysisVersion,
        parsed,
      );
      return parsed;
    }

    // Ensure any open active interval is finalized before generating analysis
    await this.questionTimingService.finalizeActiveTiming(
      attemptId,
      'RECOVERY',
    );

    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            sections: true,
            examTarget: true,
          },
        },
        timeLogs: {
          orderBy: { startTime: 'asc' },
        },
        answers: {
          include: { selectedOption: true },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt '${attemptId}' not found`);
    }

    // Fetch all exam questions with question bank hierarchy
    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: attempt.examId },
      orderBy: { displayOrder: 'asc' },
      include: {
        section: { select: { id: true, name: true, subjectId: true } },
        question: {
          include: {
            questionType: true,
            chapter: { include: { subject: true } },
            options: true,
          },
        },
      },
    });

    const totalQuestions = examQuestions.length;
    const totalTimeAvailableSeconds = attempt.exam.durationMinutes * 60;

    // ── 1. Map Time Logs & Aggregate per Question ──────────────────
    // Group time logs by examQuestionId
    const timeLogsByQuestion = new Map<string, typeof attempt.timeLogs>();
    for (const log of attempt.timeLogs) {
      const list = timeLogsByQuestion.get(log.examQuestionId) || [];
      list.push(log);
      timeLogsByQuestion.set(log.examQuestionId, list);
    }

    const answerMap = new Map(
      attempt.answers.map((a) => [a.examQuestionId, a]),
    );

    const questionSummaries: QuestionTimingSummary[] = [];
    const questionTimeValues: number[] = [];

    let totalCalculatedTimeUsedSeconds = 0;
    let attemptedQuestionsCount = 0;
    let totalWastedSeconds = 0;

    const benchmarkSecondsPerQuestion =
      attempt.exam.totalQuestions && attempt.exam.totalQuestions > 0
        ? Math.round(totalTimeAvailableSeconds / attempt.exam.totalQuestions)
        : totalQuestions > 0
          ? Math.round(totalTimeAvailableSeconds / totalQuestions)
          : 60;

    for (const eq of examQuestions) {
      const q = eq.question;
      const ans = answerMap.get(eq.id);
      const logs = timeLogsByQuestion.get(eq.id) || [];

      let totalTime = 0;
      let initialTime = 0;
      let reviewTime = 0;
      let firstVisited: Date | null = null;
      let lastVisited: Date | null = null;

      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const duration = Math.max(0, log.timeSpentSeconds);
        totalTime += duration;

        if (log.visitNumber === 1 || i === 0) {
          initialTime += duration;
        } else {
          reviewTime += duration;
        }

        if (!firstVisited || log.startTime < firstVisited) {
          firstVisited = log.startTime;
        }
        if (!lastVisited || (log.endTime && log.endTime > lastVisited)) {
          lastVisited = log.endTime || log.startTime;
        }
      }

      totalCalculatedTimeUsedSeconds += totalTime;
      questionTimeValues.push(totalTime);

      const isAttempted =
        !!ans &&
        (!!ans.selectedOptionId ||
          ans.numericalAnswer !== null ||
          !!ans.selectedOptions);
      if (isAttempted) attemptedQuestionsCount++;

      // Determine Answer Status
      let answerStatus: 'CORRECT' | 'WRONG' | 'UNATTEMPTED' = 'UNATTEMPTED';
      if (isAttempted) {
        const isCorrect = this.isAnswerCorrect(q, ans);
        answerStatus = isCorrect ? 'CORRECT' : 'WRONG';
      }

      // Time Wasted: If wrong and took longer than expected benchmark
      let questionWasted = 0;
      if (answerStatus === 'WRONG' && totalTime > benchmarkSecondsPerQuestion) {
        questionWasted = totalTime - benchmarkSecondsPerQuestion;
        totalWastedSeconds += questionWasted;
      }

      questionSummaries.push({
        examQuestionId: eq.id,
        questionId: q.id,
        displayOrder: eq.displayOrder,
        subjectId: eq.section?.subjectId || q.chapter?.subjectId || 'UNKNOWN',
        subjectName: eq.section?.name || q.chapter?.subject?.name || 'General',
        chapterId: q.chapterId || undefined,
        chapterName: q.chapter?.name || undefined,
        questionTypeCode: q.questionType?.code || undefined,
        difficultyCode: q.difficultyLevel || 'MEDIUM',
        visitCount:
          logs.length > 0 ? Math.max(...logs.map((l) => l.visitNumber)) : 0,
        totalTimeSpentSeconds: totalTime,
        initialVisitTimeSeconds: initialTime,
        reviewTimeSeconds: reviewTime,
        firstVisitedAt: firstVisited ? firstVisited.toISOString() : null,
        lastVisitedAt: lastVisited ? lastVisited.toISOString() : null,
        answerStatus,
        isMarkedForReview: ans?.isMarkedForReview || false,
        timeWastedSeconds: questionWasted,
      });
    }

    // ── 2. Time Totals & Averages ──────────────────────────────────
    const startedAt = attempt.startedAt
      ? new Date(attempt.startedAt).getTime()
      : 0;
    const submittedAt = attempt.submittedAt
      ? new Date(attempt.submittedAt).getTime()
      : Date.now();
    const wallClockTimeSeconds = Math.max(
      0,
      Math.floor((submittedAt - startedAt) / 1000),
    );
    const totalTimeUsedSeconds = Math.min(
      totalTimeAvailableSeconds,
      Math.max(totalCalculatedTimeUsedSeconds, wallClockTimeSeconds),
    );

    const timeRemainingSeconds = Math.max(
      0,
      totalTimeAvailableSeconds - totalTimeUsedSeconds,
    );
    const timeUtilizationPercentage =
      totalTimeAvailableSeconds > 0
        ? Math.round(
            (totalTimeUsedSeconds / totalTimeAvailableSeconds) * 10000,
          ) / 100
        : 0;

    const averageTimePerQuestionSeconds =
      totalQuestions > 0
        ? Math.round((totalTimeUsedSeconds / totalQuestions) * 10) / 10
        : 0;

    const averageTimePerAttemptedQuestionSeconds =
      attemptedQuestionsCount > 0
        ? Math.round((totalTimeUsedSeconds / attemptedQuestionsCount) * 10) / 10
        : averageTimePerQuestionSeconds;

    // Median Time
    const sortedTimes = [...questionTimeValues].sort((a, b) => a - b);
    const mid = Math.floor(sortedTimes.length / 2);
    const medianTimePerQuestionSeconds =
      sortedTimes.length === 0
        ? 0
        : sortedTimes.length % 2 !== 0
          ? sortedTimes[mid]
          : Math.round(((sortedTimes[mid - 1] + sortedTimes[mid]) / 2) * 10) /
            10;

    // ── 3. Fastest & Slowest Questions ─────────────────────────────
    const nonZeroQuestions = questionSummaries.filter(
      (q) => q.totalTimeSpentSeconds > 0,
    );
    const fastestQuestion =
      nonZeroQuestions.length > 0
        ? [...nonZeroQuestions].sort(
            (a, b) => a.totalTimeSpentSeconds - b.totalTimeSpentSeconds,
          )[0]
        : null;
    const slowestQuestion =
      questionSummaries.length > 0
        ? [...questionSummaries].sort(
            (a, b) => b.totalTimeSpentSeconds - a.totalTimeSpentSeconds,
          )[0]
        : null;

    // ── 4. Subject Time Breakdown ──────────────────────────────────
    const subjectMap = new Map<
      string,
      { id: string; name: string; count: number; time: number }
    >();
    for (const qs of questionSummaries) {
      const entry = subjectMap.get(qs.subjectName) || {
        id: qs.subjectId,
        name: qs.subjectName,
        count: 0,
        time: 0,
      };
      entry.count++;
      entry.time += qs.totalTimeSpentSeconds;
      subjectMap.set(qs.subjectName, entry);
    }

    const subjects: SubjectTimeSummary[] = Array.from(subjectMap.values()).map(
      (s) => {
        const timePercentage =
          totalTimeUsedSeconds > 0
            ? Math.round((s.time / totalTimeUsedSeconds) * 10000) / 100
            : 0;
        const questionPercentage =
          totalQuestions > 0
            ? Math.round((s.count / totalQuestions) * 10000) / 100
            : 0;
        return {
          subjectId: s.id,
          subjectName: s.name,
          questionCount: s.count,
          timeSpentSeconds: s.time,
          averageTimePerQuestionSeconds:
            s.count > 0 ? Math.round((s.time / s.count) * 10) / 10 : 0,
          timePercentage,
          questionPercentage,
          allocationDifference:
            Math.round((timePercentage - questionPercentage) * 100) / 100,
        };
      },
    );

    // ── 5. Chapter Time Breakdown ──────────────────────────────────
    const chapterMap = new Map<
      string,
      {
        id: string;
        name: string;
        subjectId: string;
        subjectName: string;
        count: number;
        time: number;
      }
    >();
    for (const qs of questionSummaries) {
      if (!qs.chapterId) continue;
      const entry = chapterMap.get(qs.chapterId) || {
        id: qs.chapterId,
        name: qs.chapterName || 'Unknown',
        subjectId: qs.subjectId,
        subjectName: qs.subjectName,
        count: 0,
        time: 0,
      };
      entry.count++;
      entry.time += qs.totalTimeSpentSeconds;
      chapterMap.set(qs.chapterId, entry);
    }

    const chapters: ChapterTimeSummary[] = Array.from(chapterMap.values()).map(
      (c) => ({
        chapterId: c.id,
        chapterName: c.name,
        subjectId: c.subjectId,
        subjectName: c.subjectName,
        questionCount: c.count,
        timeSpentSeconds: c.time,
        averageTimePerQuestionSeconds:
          c.count > 0 ? Math.round((c.time / c.count) * 10) / 10 : 0,
        timePercentage:
          totalTimeUsedSeconds > 0
            ? Math.round((c.time / totalTimeUsedSeconds) * 10000) / 100
            : 0,
      }),
    );

    // ── 6. Correctness Time Summary ────────────────────────────────
    let correctTime = 0,
      correctCount = 0;
    let wrongTime = 0,
      wrongCount = 0;
    let unattemptedTime = 0,
      unattemptedCount = 0;

    for (const qs of questionSummaries) {
      if (qs.answerStatus === 'CORRECT') {
        correctCount++;
        correctTime += qs.totalTimeSpentSeconds;
      } else if (qs.answerStatus === 'WRONG') {
        wrongCount++;
        wrongTime += qs.totalTimeSpentSeconds;
      } else {
        unattemptedCount++;
        unattemptedTime += qs.totalTimeSpentSeconds;
      }
    }

    const correctness: CorrectnessTimeSummary[] = [
      {
        outcome: 'CORRECT',
        count: correctCount,
        totalTimeSeconds: correctTime,
        averageTimeSeconds:
          correctCount > 0 ? Math.round(correctTime / correctCount) : 0,
        percentageOfTime:
          totalTimeUsedSeconds > 0
            ? Math.round((correctTime / totalTimeUsedSeconds) * 100)
            : 0,
      },
      {
        outcome: 'WRONG',
        count: wrongCount,
        totalTimeSeconds: wrongTime,
        averageTimeSeconds:
          wrongCount > 0 ? Math.round(wrongTime / wrongCount) : 0,
        percentageOfTime:
          totalTimeUsedSeconds > 0
            ? Math.round((wrongTime / totalTimeUsedSeconds) * 100)
            : 0,
      },
      {
        outcome: 'UNATTEMPTED',
        count: unattemptedCount,
        totalTimeSeconds: unattemptedTime,
        averageTimeSeconds:
          unattemptedCount > 0
            ? Math.round(unattemptedTime / unattemptedCount)
            : 0,
        percentageOfTime:
          totalTimeUsedSeconds > 0
            ? Math.round((unattemptedTime / totalTimeUsedSeconds) * 100)
            : 0,
      },
    ];

    // ── 7. Difficulty & Question Type Breakdown ────────────────────
    const difficulty: DifficultyTimeSummary[] = [
      {
        difficulty: 'MEDIUM',
        count: totalQuestions,
        totalTimeSeconds: totalTimeUsedSeconds,
        averageTimeSeconds: averageTimePerQuestionSeconds,
      },
    ];

    const typeMap = new Map<string, { count: number; time: number }>();
    for (const qs of questionSummaries) {
      const code = qs.questionTypeCode || 'SCQ';
      const entry = typeMap.get(code) || { count: 0, time: 0 };
      entry.count++;
      entry.time += qs.totalTimeSpentSeconds;
      typeMap.set(code, entry);
    }
    const questionTypes: QuestionTypeTimeSummary[] = Array.from(
      typeMap.entries(),
    ).map(([code, d]) => ({
      questionType: code,
      count: d.count,
      totalTimeSeconds: d.time,
      averageTimeSeconds: d.count > 0 ? Math.round(d.time / d.count) : 0,
    }));

    // ── 8. Visit & Pacing Breakdown ────────────────────────────────
    let totalVisits = 0;
    let singleVisitCount = 0;
    let multiVisitCount = 0;
    let maxVisits = 0;
    let mostVisitedQId: string | null = null;

    let rushed = 0;
    let optimal = 0;
    let overthought = 0;

    for (const qs of questionSummaries) {
      totalVisits += qs.visitCount;
      if (qs.visitCount <= 1) singleVisitCount++;
      else multiVisitCount++;

      if (qs.visitCount > maxVisits) {
        maxVisits = qs.visitCount;
        mostVisitedQId = qs.examQuestionId;
      }

      if (qs.totalTimeSpentSeconds < 15 && qs.answerStatus !== 'UNATTEMPTED') {
        rushed++;
      } else if (
        qs.totalTimeSpentSeconds > averageTimePerQuestionSeconds * 2.5 &&
        qs.totalTimeSpentSeconds > 60
      ) {
        overthought++;
      } else {
        optimal++;
      }
    }

    const report: DetailedTimeAnalysis = {
      attemptId,
      examId: attempt.examId,
      examTitle: attempt.exam.title,
      analysisVersion,
      algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
      generatedAt: new Date().toISOString(),
      totalTimeAvailableSeconds,
      totalTimeUsedSeconds,
      timeRemainingSeconds,
      timeUtilizationPercentage,
      averageTimePerQuestionSeconds,
      averageTimePerAttemptedQuestionSeconds,
      medianTimePerQuestionSeconds,
      timeWastedSeconds: totalWastedSeconds,
      fastestQuestion,
      slowestQuestion,
      visitAnalysis: {
        averageVisitsPerQuestion:
          totalQuestions > 0
            ? Math.round((totalVisits / totalQuestions) * 10) / 10
            : 0,
        questionsVisitedOnce: singleVisitCount,
        questionsVisitedMultipleTimes: multiVisitCount,
        mostVisitedQuestionId: mostVisitedQId,
        mostVisitedCount: maxVisits,
      },
      pacingDistribution: {
        rushedCount: rushed,
        optimalPaceCount: optimal,
        overthoughtCount: overthought,
      },
      subjects,
      chapters,
      correctness,
      difficulty,
      questionTypes,
      questions: questionSummaries,
    };

    // ── 9. Materialize & Cache in DB + Redis ────────────────────────
    await this.prisma.timeAnalysis.upsert({
      where: { attemptId_analysisVersion: { attemptId, analysisVersion } },
      update: {
        totalTimeAvailableSeconds,
        totalTimeUsedSeconds,
        timeRemainingSeconds,
        timeUtilizationPercentage,
        averageTimePerQuestionSeconds,
        averageTimePerAttemptedQuestion: averageTimePerAttemptedQuestionSeconds,
        medianTimePerQuestionSeconds,
        timeWastedSeconds: totalWastedSeconds,
        fastestQuestionId: fastestQuestion?.examQuestionId || null,
        slowestQuestionId: slowestQuestion?.examQuestionId || null,
        data: report as any,
      },
      create: {
        attemptId,
        analysisVersion,
        algorithmVersion: this.CURRENT_ALGORITHM_VERSION,
        totalTimeAvailableSeconds,
        totalTimeUsedSeconds,
        timeRemainingSeconds,
        timeUtilizationPercentage,
        averageTimePerQuestionSeconds,
        averageTimePerAttemptedQuestion: averageTimePerAttemptedQuestionSeconds,
        medianTimePerQuestionSeconds,
        timeWastedSeconds: totalWastedSeconds,
        fastestQuestionId: fastestQuestion?.examQuestionId || null,
        slowestQuestionId: slowestQuestion?.examQuestionId || null,
        data: report as any,
      },
    });

    await this.timingStore.setCachedAnalysis(
      attemptId,
      analysisVersion,
      report,
    );

    return report;
  }

  /**
   * Recalculate Time Analysis from raw logs
   */
  async recalculateTimeAnalysis(
    attemptId: string,
    version: number = 1,
  ): Promise<DetailedTimeAnalysis> {
    await this.timingStore.invalidateAnalysisCache(attemptId, version);
    return this.generateTimeAnalysis(attemptId, version);
  }

  /**
   * Granular Queries
   */
  async getTimeSummary(attemptId: string) {
    const full = await this.generateTimeAnalysis(attemptId);
    return {
      attemptId: full.attemptId,
      examId: full.examId,
      totalTimeAvailableSeconds: full.totalTimeAvailableSeconds,
      totalTimeUsedSeconds: full.totalTimeUsedSeconds,
      timeRemainingSeconds: full.timeRemainingSeconds,
      timeUtilizationPercentage: full.timeUtilizationPercentage,
      averageTimePerQuestionSeconds: full.averageTimePerQuestionSeconds,
      averageTimePerAttemptedQuestionSeconds:
        full.averageTimePerAttemptedQuestionSeconds,
      medianTimePerQuestionSeconds: full.medianTimePerQuestionSeconds,
      timeWastedSeconds: full.timeWastedSeconds,
      fastestQuestion: full.fastestQuestion,
      slowestQuestion: full.slowestQuestion,
      pacingDistribution: full.pacingDistribution,
      visitAnalysis: full.visitAnalysis,
    };
  }

  async getQuestionTiming(attemptId: string, questionId: string) {
    const full = await this.generateTimeAnalysis(attemptId);
    const q = full.questions.find(
      (x) => x.examQuestionId === questionId || x.questionId === questionId,
    );
    if (!q)
      throw new NotFoundException('Question timing not found for this attempt');
    return q;
  }

  async getSubjectTiming(attemptId: string) {
    const full = await this.generateTimeAnalysis(attemptId);
    return full.subjects;
  }

  async getChapterTiming(attemptId: string) {
    const full = await this.generateTimeAnalysis(attemptId);
    return full.chapters;
  }

  // ── Helper: Check Answer Correctness ──────────────────────────
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
}
