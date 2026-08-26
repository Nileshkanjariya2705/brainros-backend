import { SeedContext, SeederResult } from './types';
import {
  RankType,
  RankSnapshotStatus,
  PredictionStatus,
} from '@prisma/client';

export async function seedResultsAndAnalytics(ctx: SeedContext): Promise<SeederResult> {
  const start = Date.now();
  const created: Record<string, number> = {};
  const reused: Record<string, number> = {};

  const inc = (type: string, isNew: boolean) => {
    if (isNew) created[type] = (created[type] || 0) + 1;
    else reused[type] = (reused[type] || 0) + 1;
  };

  const { prisma } = ctx;
  const examMock01 = ctx.exams.get('EXAM_NEET_MOCK_01')!;
  const examMock01Version = ctx.examVersions.get('EXAM_NEET_MOCK_01:1')!;
  const examQuestions = ctx.examQuestions.get(examMock01.id) || [];

  // Load all attempts for EXAM_NEET_MOCK_01 with student and answers
  const attempts = await prisma.attempt.findMany({
    where: { examId: examMock01.id },
    include: {
      student: { include: { stateRef: true, districtRef: true } },
      answers: {
        include: {
          examQuestion: { include: { question: { include: { options: true } }, section: true } },
          selectedOption: true,
        },
      },
      timeLogs: true,
    },
  });

  interface EvaluatedAttemptData {
    attemptId: string;
    studentId: string;
    studentName: string;
    stateName: string;
    districtName: string;
    totalScore: number;
    maxScore: number;
    percentage: number;
    accuracy: number;
    correctCount: number;
    wrongCount: number;
    unattemptedCount: number;
    timeUsedSeconds: number;
    subjectStats: Record<string, { total: number; correct: number; wrong: number; score: number }>;
  }

  const evaluatedList: EvaluatedAttemptData[] = [];

  for (const att of attempts) {
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;
    let totalScore = 0;
    const maxScore = examQuestions.length * 4;

    const subjectStats: Record<
      string,
      { subjectId: string; total: number; correct: number; wrong: number; score: number }
    > = {};

    for (const ans of att.answers) {
      const q = ans.examQuestion.question;
      const subj = ans.examQuestion.section;
      const subjId = subj.subjectId;

      if (!subjectStats[subjId]) {
        subjectStats[subjId] = { subjectId: subjId, total: 0, correct: 0, wrong: 0, score: 0 };
      }
      subjectStats[subjId].total += 1;

      if (!ans.selectedOptionId) {
        unattemptedCount += 1;
      } else if (ans.selectedOption?.isCorrect) {
        correctCount += 1;
        totalScore += 4;
        subjectStats[subjId].correct += 1;
        subjectStats[subjId].score += 4;
      } else {
        wrongCount += 1;
        totalScore -= 1;
        subjectStats[subjId].wrong += 1;
        subjectStats[subjId].score -= 1;
      }
    }

    const totalAnswered = correctCount + wrongCount;
    const accuracy = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0;
    const percentage = Math.max(0, (totalScore / maxScore) * 100);
    const totalTimeUsed = att.timeLogs.reduce((acc, l) => acc + l.timeSpentSeconds, 0);

    // 1. Persist Result (Upsert)
    const result = await prisma.result.upsert({
      where: { attemptId: att.id },
      update: {
        totalQuestions: examQuestions.length,
        correctAnswers: correctCount,
        wrongAnswers: wrongCount,
        unattempted: unattemptedCount,
        totalScore,
        maxScore,
        percentage,
        accuracy,
        timeUsedSeconds: totalTimeUsed,
        averageTimePerQuestion: totalTimeUsed / (examQuestions.length || 1),
      },
      create: {
        attemptId: att.id,
        totalQuestions: examQuestions.length,
        correctAnswers: correctCount,
        wrongAnswers: wrongCount,
        unattempted: unattemptedCount,
        totalScore,
        maxScore,
        percentage,
        accuracy,
        timeUsedSeconds: totalTimeUsed,
        averageTimePerQuestion: totalTimeUsed / (examQuestions.length || 1),
      },
    });
    inc('results', true);
    ctx.results.set(att.id, result);

    // 2. Persist Subject Results
    for (const sId of Object.keys(subjectStats)) {
      const sStat = subjectStats[sId];
      const sMaxScore = sStat.total * 4;
      const sAcc = (sStat.correct + sStat.wrong > 0)
        ? (sStat.correct / (sStat.correct + sStat.wrong)) * 100
        : 0;

      await prisma.subjectResult.upsert({
        where: { resultId_subjectId: { resultId: result.id, subjectId: sId } },
        update: {
          totalQuestions: sStat.total,
          correctAnswers: sStat.correct,
          wrongAnswers: sStat.wrong,
          unattempted: sStat.total - (sStat.correct + sStat.wrong),
          score: sStat.score,
          maxScore: sMaxScore,
          accuracy: sAcc,
          percentage: (sStat.score / sMaxScore) * 100,
        },
        create: {
          resultId: result.id,
          subjectId: sId,
          totalQuestions: sStat.total,
          correctAnswers: sStat.correct,
          wrongAnswers: sStat.wrong,
          unattempted: sStat.total - (sStat.correct + sStat.wrong),
          score: sStat.score,
          maxScore: sMaxScore,
          accuracy: sAcc,
          percentage: (sStat.score / sMaxScore) * 100,
          performanceStatus: sAcc >= 80 ? 'EXCELLENT' : sAcc >= 50 ? 'AVERAGE' : 'NEEDS_IMPROVEMENT',
        },
      });
      inc('subject_results', true);
    }

    // 3. Persist Time Analysis (Upsert)
    await prisma.timeAnalysis.upsert({
      where: { attemptId_analysisVersion: { attemptId: att.id, analysisVersion: 1 } },
      update: {
        totalTimeAvailableSeconds: 3600,
        totalTimeUsedSeconds: totalTimeUsed,
        timeRemainingSeconds: Math.max(0, 3600 - totalTimeUsed),
        timeUtilizationPercentage: (totalTimeUsed / 3600) * 100,
        averageTimePerQuestionSeconds: totalTimeUsed / (examQuestions.length || 1),
        averageTimePerAttemptedQuestion: totalTimeUsed / (totalAnswered || 1),
      },
      create: {
        attemptId: att.id,
        analysisVersion: 1,
        algorithmVersion: 'v1.0.0',
        totalTimeAvailableSeconds: 3600,
        totalTimeUsedSeconds: totalTimeUsed,
        timeRemainingSeconds: Math.max(0, 3600 - totalTimeUsed),
        timeUtilizationPercentage: (totalTimeUsed / 3600) * 100,
        averageTimePerQuestionSeconds: totalTimeUsed / (examQuestions.length || 1),
        averageTimePerAttemptedQuestion: totalTimeUsed / (totalAnswered || 1),
        medianTimePerQuestionSeconds: 65,
        timeWastedSeconds: wrongCount * 45,
        data: {
          paceClassification: totalTimeUsed < 2800 ? 'FAST' : 'BALANCED',
          rushEndPercentage: 5.2,
        },
      },
    });
    inc('time_analyses', true);

    // 4. Persist Strategy Analysis (Upsert)
    const isAggressive = wrongCount > 4;
    await prisma.strategyAnalysis.upsert({
      where: { attemptId_strategyVersion: { attemptId: att.id, strategyVersion: 1 } },
      update: {
        projectedScore: totalScore + wrongCount * 1.5,
        avoidableNegativeMarks: wrongCount * 1.0,
      },
      create: {
        attemptId: att.id,
        strategyVersion: 1,
        algorithmVersion: 'v1.0.0',
        primaryClassification: isAggressive ? 'HIGH_RISK_AGGRESSIVE' : 'BALANCED',
        classifications: isAggressive ? ['HIGH_RISK', 'TIME_OVERUSE'] : ['BALANCED', 'CONSISTENT'],
        metrics: {
          coveragePercentage: (totalAnswered / examQuestions.length) * 100,
          riskFactor: wrongCount / (examQuestions.length || 1),
        },
        recommendations: [
          {
            type: 'NEGATIVE_MARKS',
            message: `Eliminate speculative guesswork to save ${wrongCount} negative marks.`,
          },
        ],
        projectedImprovementMarks: wrongCount * 2.5,
        projectedScore: totalScore + wrongCount * 1.5,
        avoidableNegativeMarks: wrongCount * 1.0,
        data: { generatedAt: new Date() },
      },
    });
    inc('strategy_analyses', true);

    // 5. Predicted Rank (Upsert)
    const predictedRankVal = Math.max(1, Math.round(500000 - (totalScore / maxScore) * 490000));
    await prisma.predictionResult.upsert({
      where: {
        attemptId_modelVersion_configVersion_datasetVersion: {
          attemptId: att.id,
          modelVersion: 'v1.0.0',
          configVersion: 1,
          datasetVersion: 1,
        },
      },
      update: {
        inputScore: totalScore,
        normalizedScore: percentage,
        predictedRank: predictedRankVal,
      },
      create: {
        attemptId: att.id,
        examVersionId: examMock01Version.id,
        modelCode: 'HISTORICAL_INTERPOLATION',
        modelVersion: 'v1.0.0',
        configVersion: 1,
        datasetVersion: 1,
        inputScore: totalScore,
        normalizedScore: percentage,
        predictedRank: predictedRankVal,
        predictedRankMin: Math.max(1, Math.round(predictedRankVal * 0.85)),
        predictedRankMax: Math.round(predictedRankVal * 1.15),
        confidence: 'HIGH',
        confidenceScore: 88.5,
        percentileEstimate: percentage,
        status: PredictionStatus.COMPLETED,
      },
    });
    inc('prediction_results', true);

    evaluatedList.push({
      attemptId: att.id,
      studentId: att.student.id,
      studentName: att.student.name,
      stateName: att.student.state,
      districtName: att.student.district,
      totalScore,
      maxScore,
      percentage,
      accuracy,
      correctCount,
      wrongCount,
      unattemptedCount,
      timeUsedSeconds: totalTimeUsed,
      subjectStats: {},
    });
  }

  // 6. Rank Generation across candidates (Strict Competition Ranking)
  evaluatedList.sort((a, b) => b.totalScore - a.totalScore);

  const highestScore = evaluatedList[0]?.totalScore || 0;
  const lowestScore = evaluatedList[evaluatedList.length - 1]?.totalScore || 0;
  const avgScore = evaluatedList.reduce((acc, e) => acc + e.totalScore, 0) / (evaluatedList.length || 1);

  const rankSnapshot = await prisma.rankSnapshot.upsert({
    where: { examId_snapshotVersion: { examId: examMock01.id, snapshotVersion: 1 } },
    update: {
      totalCandidates: evaluatedList.length,
      highestScore,
      lowestScore,
      averageScore: avgScore,
      completedAt: new Date(),
    },
    create: {
      examId: examMock01.id,
      examVersionId: examMock01Version.id,
      snapshotVersion: 1,
      algorithmVersion: 'v1.0.0',
      configVersion: 1,
      status: RankSnapshotStatus.COMPLETED,
      totalCandidates: evaluatedList.length,
      highestScore,
      lowestScore,
      averageScore: avgScore,
      medianScore: evaluatedList[Math.floor(evaluatedList.length / 2)]?.totalScore || 0,
      integrityChecksPassed: true,
      completedAt: new Date(),
    },
  });
  inc('rank_snapshots', true);

  for (let rIdx = 0; rIdx < evaluatedList.length; rIdx++) {
    const item = evaluatedList[rIdx];
    const rank = rIdx + 1;
    const percentile = ((evaluatedList.length - rank) / evaluatedList.length) * 100;

    // Overall All-India Rank
    await prisma.candidateRank.upsert({
      where: {
        rankSnapshotId_attemptId_rankType_scopeId_categoryId: {
          rankSnapshotId: rankSnapshot.id,
          attemptId: item.attemptId,
          rankType: RankType.OVERALL,
          scopeId: '',
          categoryId: '',
        },
      },
      update: {
        rank,
        percentile,
        score: item.totalScore,
        accuracy: item.accuracy,
      },
      create: {
        rankSnapshotId: rankSnapshot.id,
        attemptId: item.attemptId,
        studentId: item.studentId,
        rankType: RankType.OVERALL,
        scopeId: '',
        categoryId: '',
        rank,
        totalCandidates: evaluatedList.length,
        percentile,
        score: item.totalScore,
        accuracy: item.accuracy,
        timeUsedSeconds: item.timeUsedSeconds,
        predictedRankMin: Math.max(1, rank * 10),
        predictedRankMax: rank * 15,
        predictionConfidence: 'HIGH',
      },
    });
    inc('candidate_ranks', true);

    // State Rank
    const stateCandidates = evaluatedList.filter((e) => e.stateName === item.stateName);
    const stateRank = stateCandidates.findIndex((e) => e.attemptId === item.attemptId) + 1;
    const statePercentile = ((stateCandidates.length - stateRank) / (stateCandidates.length || 1)) * 100;

    await prisma.candidateRank.upsert({
      where: {
        rankSnapshotId_attemptId_rankType_scopeId_categoryId: {
          rankSnapshotId: rankSnapshot.id,
          attemptId: item.attemptId,
          rankType: RankType.STATE,
          scopeId: item.stateName,
          categoryId: '',
        },
      },
      update: {
        rank: stateRank,
        percentile: statePercentile,
        score: item.totalScore,
      },
      create: {
        rankSnapshotId: rankSnapshot.id,
        attemptId: item.attemptId,
        studentId: item.studentId,
        rankType: RankType.STATE,
        scopeId: item.stateName,
        scopeName: item.stateName,
        categoryId: '',
        rank: stateRank,
        totalCandidates: stateCandidates.length,
        percentile: statePercentile,
        score: item.totalScore,
        accuracy: item.accuracy,
        timeUsedSeconds: item.timeUsedSeconds,
      },
    });
    inc('candidate_ranks', true);
  }

  return {
    seederName: 'ResultsAndAnalyticsSeeder',
    createdCounts: created,
    reusedCounts: reused,
    timeMs: Date.now() - start,
  };
}
