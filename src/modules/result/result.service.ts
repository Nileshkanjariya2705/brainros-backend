import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ResultService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate and persist results for a submitted attempt.
   * This is the core scoring engine — runs as a single transaction.
   */
  async calculateResult(attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        status: true,
        result: true,
        exam: {
          include: {
            scoringRules: { include: { questionType: true } },
          },
        },
      },
    });

    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!['SUBMITTED', 'AUTO_SUBMITTED'].includes(attempt.status.name)) {
      throw new BadRequestException('Attempt must be submitted before calculating results');
    }

    // Skip if result already calculated
    if (attempt.result) return attempt.result;

    // Fetch all exam questions with their correct answers
    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: attempt.examId },
      include: {
        question: {
          include: {
            questionType: true,
            options: { select: { id: true, isCorrect: true } },
          },
        },
        section: { select: { subjectId: true } },
      },
    });

    // Fetch student answers
    const answers = await this.prisma.answer.findMany({
      where: { attemptId },
    });
    const answerMap = new Map(answers.map((a) => [a.examQuestionId, a]));

    // Build scoring rules map: questionTypeId → { marks, negativeMarks }
    const scoringRules = new Map<string, { marks: number; negativeMarks: number }>();
    for (const rule of attempt.exam.scoringRules) {
      if (rule.questionTypeId) {
        scoringRules.set(rule.questionTypeId, {
          marks: rule.marksPerQuestion,
          negativeMarks: rule.negativeMarksPerQuestion,
        });
      }
    }

    // ─── Score each question ───────────────────────────────────
    let totalCorrect = 0;
    let totalWrong = 0;
    let totalUnattempted = 0;
    let totalScore = 0;
    let maxScore = 0;

    // Subject-level accumulators
    const subjectMap = new Map<string, {
      totalQuestions: number; correct: number; wrong: number;
      unattempted: number; score: number; maxScore: number;
    }>();

    // Chapter-level accumulators
    const chapterMap = new Map<string, {
      totalQuestions: number; correct: number; wrong: number;
      unattempted: number; score: number;
    }>();

    for (const eq of examQuestions) {
      const answer = answerMap.get(eq.id);
      const question = eq.question;
      const subjectId = eq.section.subjectId;
      const chapterId = question.chapterId;

      // Determine marks for this question
      const rule = scoringRules.get(question.questionTypeId);
      const marksForCorrect = eq.marks ?? rule?.marks ?? attempt.exam.defaultMarksPerQuestion;
      const marksForWrong = eq.negativeMarks ?? rule?.negativeMarks ?? attempt.exam.defaultNegativeMarks;

      maxScore += marksForCorrect;

      // Init accumulators
      if (!subjectMap.has(subjectId)) {
        subjectMap.set(subjectId, {
          totalQuestions: 0, correct: 0, wrong: 0, unattempted: 0, score: 0, maxScore: 0,
        });
      }
      if (!chapterMap.has(chapterId)) {
        chapterMap.set(chapterId, {
          totalQuestions: 0, correct: 0, wrong: 0, unattempted: 0, score: 0,
        });
      }

      const subj = subjectMap.get(subjectId)!;
      const chap = chapterMap.get(chapterId)!;
      subj.totalQuestions++;
      subj.maxScore += marksForCorrect;
      chap.totalQuestions++;

      if (!answer || (!answer.selectedOptionId && answer.numericalAnswer === null && !answer.selectedOptions)) {
        // Unattempted
        totalUnattempted++;
        subj.unattempted++;
        chap.unattempted++;
        continue;
      }

      // Evaluate correctness based on question type
      const isCorrect = this.evaluateAnswer(question, answer);

      if (isCorrect) {
        totalCorrect++;
        totalScore += marksForCorrect;
        subj.correct++;
        subj.score += marksForCorrect;
        chap.correct++;
        chap.score += marksForCorrect;
      } else {
        totalWrong++;
        totalScore -= marksForWrong;
        subj.wrong++;
        subj.score -= marksForWrong;
        chap.wrong++;
        chap.score -= marksForWrong;
      }
    }

    const totalQuestions = examQuestions.length;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const attempted = totalCorrect + totalWrong;
    const accuracy = attempted > 0 ? (totalCorrect / attempted) * 100 : 0;

    // ─── Persist results in a transaction ──────────────────────
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.result.create({
        data: {
          attemptId,
          totalQuestions,
          correctAnswers: totalCorrect,
          wrongAnswers: totalWrong,
          unattempted: totalUnattempted,
          totalScore: Math.max(totalScore, 0), // Floor at 0
          maxScore,
          percentage: Math.round(percentage * 100) / 100,
          accuracy: Math.round(accuracy * 100) / 100,
        },
      });

      // Subject results
      for (const [subjectId, data] of subjectMap) {
        const attempted = data.correct + data.wrong;
        await tx.subjectResult.create({
          data: {
            resultId: result.id,
            subjectId,
            totalQuestions: data.totalQuestions,
            correctAnswers: data.correct,
            wrongAnswers: data.wrong,
            unattempted: data.unattempted,
            score: Math.max(data.score, 0),
            maxScore: data.maxScore,
            accuracy: attempted > 0 ? Math.round((data.correct / attempted) * 10000) / 100 : 0,
          },
        });
      }

      // Chapter results
      for (const [chapterId, data] of chapterMap) {
        const attempted = data.correct + data.wrong;
        const chapterAccuracy = attempted > 0 ? (data.correct / attempted) * 100 : 0;
        let performanceStatus = 'NOT_ATTEMPTED';
        if (attempted > 0) {
          if (chapterAccuracy >= 80) performanceStatus = 'STRONG';
          else if (chapterAccuracy >= 50) performanceStatus = 'MODERATE';
          else performanceStatus = 'WEAK';
        }

        await tx.chapterResult.create({
          data: {
            resultId: result.id,
            chapterId,
            totalQuestions: data.totalQuestions,
            correctAnswers: data.correct,
            wrongAnswers: data.wrong,
            unattempted: data.unattempted,
            score: Math.max(data.score, 0),
            accuracy: Math.round(chapterAccuracy * 100) / 100,
            performanceStatus,
          },
        });
      }

      return this.getResult(attemptId);
    });
  }

  /**
   * Get result for an attempt
   */
  async getResult(attemptId: string) {
    const result = await this.prisma.result.findUnique({
      where: { attemptId },
      include: {
        attempt: {
          select: {
            id: true,
            examId: true,
            startedAt: true,
            submittedAt: true,
            exam: {
              select: {
                id: true,
                title: true,
                totalQuestions: true,
                totalMarks: true,
                durationMinutes: true,
                examTarget: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!result) throw new NotFoundException('Result not found. Exam may not be submitted yet.');
    return result;
  }

  /**
   * Get subject-wise breakdown
   */
  async getSubjectResults(attemptId: string) {
    const result = await this.prisma.result.findUnique({ where: { attemptId } });
    if (!result) throw new NotFoundException('Result not found');

    return this.prisma.subjectResult.findMany({
      where: { resultId: result.id },
      include: {
        subject: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Get chapter-wise breakdown
   */
  async getChapterResults(attemptId: string) {
    const result = await this.prisma.result.findUnique({ where: { attemptId } });
    if (!result) throw new NotFoundException('Result not found');

    return this.prisma.chapterResult.findMany({
      where: { resultId: result.id },
      include: {
        chapter: {
          select: {
            id: true,
            name: true,
            subject: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * Get detailed answer review (shows correct answers after submission)
   */
  async getAnswerReview(attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { status: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!['SUBMITTED', 'AUTO_SUBMITTED'].includes(attempt.status.name)) {
      throw new BadRequestException('Exam must be submitted to view review');
    }

    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: attempt.examId },
      orderBy: { displayOrder: 'asc' },
      include: {
        section: { select: { name: true } },
        question: {
          include: {
            questionType: { select: { name: true, code: true } },
            translations: {
              where: { languageId: attempt.languageId },
            },
            options: {
              orderBy: { displayOrder: 'asc' },
              include: {
                translations: {
                  where: { languageId: attempt.languageId },
                },
              },
            },
          },
        },
      },
    });

    const answers = await this.prisma.answer.findMany({
      where: { attemptId },
    });
    const answerMap = new Map(answers.map((a) => [a.examQuestionId, a]));

    return examQuestions.map((eq) => {
      const answer = answerMap.get(eq.id);
      return {
        displayOrder: eq.displayOrder,
        sectionName: eq.section.name,
        questionType: eq.question.questionType,
        questionText: eq.question.translations[0]?.questionText ?? '',
        explanation: eq.question.translations[0]?.explanation ?? '',
        options: eq.question.options.map((o) => ({
          id: o.id,
          optionLabel: o.optionLabel,
          optionText: o.translations[0]?.optionText ?? '',
          isCorrect: o.isCorrect,
        })),
        studentAnswer: answer ? {
          selectedOptionId: answer.selectedOptionId,
          numericalAnswer: answer.numericalAnswer,
          isMarkedForReview: answer.isMarkedForReview,
        } : null,
        isCorrect: answer ? this.evaluateAnswer(eq.question, answer) : false,
        isAttempted: !!answer && (!!answer.selectedOptionId || answer.numericalAnswer !== null),
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE: Answer Evaluation
  // ═══════════════════════════════════════════════════════════════

  private evaluateAnswer(question: any, answer: any): boolean {
    const code = question.questionType?.code;

    switch (code) {
      case 'SCQ':
      case 'TF':
      case 'AR': {
        // Single correct: compare selectedOptionId with the correct option
        if (!answer.selectedOptionId) return false;
        const correctOption = question.options.find((o: any) => o.isCorrect);
        return correctOption ? answer.selectedOptionId === correctOption.id : false;
      }

      case 'MCQ': {
        // Multiple correct: compare selected set with correct set
        const selected = answer.selectedOptions as string[] | null;
        if (!selected || selected.length === 0) return false;
        const correctIds = new Set<string>(question.options.filter((o: any) => o.isCorrect).map((o: any) => o.id));
        const selectedSet = new Set<string>(selected);
        if (correctIds.size !== selectedSet.size) return false;
        for (const id of correctIds) {
          if (!selectedSet.has(id)) return false;
        }
        return true;
      }

      case 'NUM': {
        // Numerical: compare with correctAnswer JSON field
        if (answer.numericalAnswer === null || answer.numericalAnswer === undefined) return false;
        const correctValue = question.correctAnswer;
        if (correctValue === null || correctValue === undefined) return false;
        // Support exact match or range
        if (typeof correctValue === 'number') {
          return Math.abs(answer.numericalAnswer - correctValue) < 0.001;
        }
        if (typeof correctValue === 'object' && correctValue.min !== undefined && correctValue.max !== undefined) {
          return answer.numericalAnswer >= correctValue.min && answer.numericalAnswer <= correctValue.max;
        }
        return false;
      }

      default:
        return false;
    }
  }
}
