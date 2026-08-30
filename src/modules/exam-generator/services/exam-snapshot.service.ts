import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamRandomizationService } from './exam-randomization.service';

export interface CreateSnapshotParams {
  exam: any;
  blueprint: any;
  selectedQuestions: any[];
  generationSeed: string;
  generatedById: string;
  languages: any[];
}

@Injectable()
export class ExamSnapshotService {
  private readonly logger = new Logger(ExamSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly randomizationService: ExamRandomizationService,
  ) {}

  /**
   * Atomically compiles and persists the complete immutable ExamVersion snapshot
   */
  async persistImmutableExamVersionSnapshot(params: CreateSnapshotParams) {
    const {
      exam,
      blueprint,
      selectedQuestions,
      generationSeed,
      generatedById,
      languages,
    } = params;

    // 1. Shuffles question sequence
    const shuffledQuestions = this.randomizationService.shuffleArray(
      selectedQuestions,
      `${generationSeed}_questions`,
    );

    // 2. Fetch highest version number for this exam
    const existingMaxVersion = await this.prisma.examVersion.aggregate({
      where: { examId: exam.id },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (existingMaxVersion._max.versionNumber || 0) + 1;

    // 3. Construct scoring scheme snapshot
    const markingSchemeSnapshot = {
      defaultMarksPerQuestion: exam.defaultMarksPerQuestion,
      defaultNegativeMarks: exam.defaultNegativeMarks,
      totalMarks: exam.totalMarks,
      durationMinutes: exam.durationMinutes,
      scoringRules: exam.scoringRules || [],
    };

    return this.prisma.$transaction(async (tx) => {
      // Create ExamVersion header
      const examVersion = await tx.examVersion.create({
        data: {
          examId: exam.id,
          blueprintId: blueprint?.id || null,
          versionNumber: nextVersionNumber,
          status: 'GENERATED',
          generationSeed,
          totalQuestions: shuffledQuestions.length,
          durationMinutes: exam.durationMinutes,
          totalMarks: exam.totalMarks,
          markingSchemeSnapshot,
          metadata: {
            blueprintName: blueprint?.name || 'Manual Blueprint',
            blueprintVersion: blueprint?.version || 1,
            languagesConfigured: languages.map((l) => ({
              id: l.language?.id || l.id,
              code: l.language?.code || l.code,
              name: l.language?.name || l.name,
            })),
          },
          generatedById,
        },
      });

      // Create Question Snapshots
      for (let seq = 0; seq < shuffledQuestions.length; seq++) {
        const q = shuffledQuestions[seq];
        const sequenceNumber = seq + 1;

        // Extract primary translation or default
        const primaryTr =
          q.translations?.find(
            (t: any) => t.languageId === q.defaultLanguageId,
          ) || q.translations?.[0];

        // Create immutable ExamVersionQuestion
        const evq = await tx.examVersionQuestion.create({
          data: {
            examVersionId: examVersion.id,
            sourceQuestionId: q.id,
            sourceQuestionVersion: q.version || 1,
            sequenceNumber,
            subjectName: q.subject?.name || null,
            type: q.type,
            difficultyLevel: q.difficultyLevel,
            marks: q.marks ?? exam.defaultMarksPerQuestion,
            negativeMarks: q.negativeMarks ?? exam.defaultNegativeMarks,
            passage: primaryTr?.passageText || q.passage || null,
            assertion: primaryTr?.assertionText || q.assertion || null,
            reason: primaryTr?.reasonText || q.reason || null,
            questionText: primaryTr?.questionText || 'Question statement',
            explanation:
              primaryTr?.explanation || q.explanation?.explanation || null,
            correctAnswer: q.answer
              ? {
                  answerType: q.answer.answerType,
                  correctOptionIds: q.answer.correctOptionIds,
                  numericalAnswer: q.answer.numericalAnswer,
                  numericalTolerance: q.answer.numericalTolerance,
                  matchPairs: q.answer.matchPairs,
                }
              : Prisma.JsonNull,
          },
        });

        // 4. Randomize and snapshot options
        const optionSeed = `${generationSeed}_q_${q.id}_opts`;
        const shuffledOptions = this.randomizationService.shuffleOptions(
          (q.options || []) as any[],
          optionSeed,
        );

        const createdOptionMap = new Map<string, string>(); // sourceOptionId -> examVersionOptionId

        for (const opt of shuffledOptions) {
          const evOpt = await tx.examVersionOption.create({
            data: {
              examVersionQuestionId: evq.id,
              sourceOptionId: opt.id,
              displayOrder: opt.displayOrder,
              optionKey: opt.optionKey || 'A',
              optionLabel: opt.optionLabel || opt.optionText || '',
              optionText: opt.optionText || opt.optionLabel || '',
              isCorrect: opt.isCorrect ?? false,
            },
          });
          createdOptionMap.set(opt.id, evOpt.id);

          // Snapshot option translations
          if (opt.translations && opt.translations.length > 0) {
            for (const ot of opt.translations) {
              const langCode =
                languages.find(
                  (l) => (l.language?.id || l.id) === ot.languageId,
                )?.language?.code || 'en';

              await tx.examVersionOptionTranslation.create({
                data: {
                  examVersionOptionId: evOpt.id,
                  languageId: ot.languageId,
                  languageCode: langCode,
                  optionText: ot.optionText,
                },
              });
            }
          }
        }

        // 5. Snapshot multilingual question translations
        if (q.translations && q.translations.length > 0) {
          for (const qt of q.translations) {
            const langCode =
              languages.find((l) => (l.language?.id || l.id) === qt.languageId)
                ?.language?.code || 'en';

            await tx.examVersionTranslation.create({
              data: {
                examVersionQuestionId: evq.id,
                languageId: qt.languageId,
                languageCode: langCode,
                questionText: qt.questionText,
                passageText: qt.passageText || null,
                assertionText: qt.assertionText || null,
                reasonText: qt.reasonText || null,
                explanation: qt.explanation || null,
              },
            });
          }
        }
      }

      return examVersion;
    });
  }
}
