import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlueprintValidationService } from './blueprint-validation.service';
import { QuestionPoolService } from './question-pool.service';
import { ExamSnapshotService } from './exam-snapshot.service';
import { ExamRandomizationService } from './exam-randomization.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';

interface ExamGenJobData {
  examId: string;
  blueprintId: string;
  createdById: string;
}

@Processor('exam-generation')
@Injectable()
export class ExamGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: BlueprintValidationService,
    private readonly poolService: QuestionPoolService,
    private readonly snapshotService: ExamSnapshotService,
    private readonly randomizationService: ExamRandomizationService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Exam generation worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<ExamGenJobData>): Promise<any> {
    const { examId, blueprintId, createdById } = job.data;
    const jobId = String(job.id || `exam_gen_${examId}`);
    this.logger.log(`Starting background exam generation for exam: ${examId}, blueprint: ${blueprintId}`);

    await this.jobProgressService.publishStarted('exam-generation', jobId, {
      type: 'EXAM_GENERATION',
      stage: 'SELECTING_QUESTIONS',
      examId,
      userId: createdById,
      message: 'Selecting questions for blueprint...',
    });

    try {
      // 1. Fetch Exam and Blueprint
      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        include: {
          languages: { include: { language: true } },
        },
      });
      if (!exam) throw new Error(`Exam with ID ${examId} not found`);

      const blueprint = await this.prisma.examBlueprint.findUnique({
        where: { id: blueprintId },
        include: { rules: true },
      });
      if (!blueprint) throw new Error(`Blueprint with ID ${blueprintId} not found`);

      // 2. Resolve rules & select questions
      const resolvedRules = this.validationService.resolveBlueprintRuleCounts(
        blueprint.totalQuestions,
        blueprint.rules,
      );

      const generationSeed = this.randomizationService.generateSeed();
      const languagesConfigured = exam.languages || [];
      const requiredLangIds = languagesConfigured.map((l) => l.languageId);

      const selectedQuestions = await this.poolService.selectQuestionsForBlueprint(
        resolvedRules,
        generationSeed,
        requiredLangIds.length > 0 ? requiredLangIds : undefined,
      );

      if (selectedQuestions.length < blueprint.totalQuestions) {
        throw new Error(`Insufficient questions in the pool. Needed ${blueprint.totalQuestions}, got ${selectedQuestions.length}`);
      }

      await this.jobProgressService.publishProgress('exam-generation', jobId, 50, 100, {
        stage: 'POPULATING_SECTIONS',
        stageIndex: 2,
        totalStages: 4,
        message: `Selected ${selectedQuestions.length} questions. Populating exam sections...`,
        examId,
        userId: createdById,
      });

      // 3. Atomically populate sections, legacy questions, and save snapshot version
      await this.prisma.$transaction(async (tx) => {
        let order = 1;
        const sectionMap = new Map<string, string>(); // subjectId -> sectionId

        // Clear existing sections & questions if any
        await tx.examQuestion.deleteMany({ where: { examId: exam.id } });
        await tx.examSection.deleteMany({ where: { examId: exam.id } });

        // Group by subject and insert sections/questions
        for (const q of selectedQuestions) {
          if (!sectionMap.has(q.subjectId)) {
            const subject = await tx.subject.findUnique({
              where: { id: q.subjectId },
              select: { name: true },
            });
            const sectionName = subject?.name || 'Section';
            const section = await tx.examSection.create({
              data: {
                examId: exam.id,
                subjectId: q.subjectId,
                name: sectionName,
                totalQuestions: selectedQuestions.filter(x => x.subjectId === q.subjectId).length,
                displayOrder: sectionMap.size + 1,
              },
            });
            sectionMap.set(q.subjectId, section.id);
          }

          await tx.examQuestion.create({
            data: {
              examId: exam.id,
              sectionId: sectionMap.get(q.subjectId)!,
              questionId: q.id,
              displayOrder: order++,
              marks: exam.defaultMarksPerQuestion,
              negativeMarks: exam.defaultNegativeMarks,
            },
          });
        }
      });

      await this.jobProgressService.publishProgress('exam-generation', jobId, 80, 100, {
        stage: 'CREATING_SNAPSHOT',
        stageIndex: 3,
        totalStages: 4,
        message: 'Persisting immutable version snapshot...',
        examId,
        userId: createdById,
      });

      // 4. Save version snapshot
      const examVersion = await this.snapshotService.persistImmutableExamVersionSnapshot({
        exam,
        blueprint,
        selectedQuestions,
        generationSeed,
        generatedById: createdById,
        languages: languagesConfigured,
      });

      // 5. Update Exam status to DRAFT (fully populated)
      const draftStatus = await this.prisma.examStatus.findUnique({
        where: { name: 'DRAFT' },
      });
      if (draftStatus) {
        await this.prisma.exam.update({
          where: { id: exam.id },
          data: { statusId: draftStatus.id },
        });
      }

      await this.jobProgressService.publishCompleted('exam-generation', jobId, {
        message: 'Exam generation completed successfully.',
        examId,
        userId: createdById,
        resultSummary: { examVersionId: examVersion.id, totalQuestions: selectedQuestions.length },
      });

      this.logger.log(`Exam generation finished successfully for exam ${examId}`);
      return { success: true, examVersionId: examVersion.id };
    } catch (err: any) {
      this.logger.error(`Failed background exam generation: ${err.message}`, err.stack);
      
      await this.jobProgressService.publishFailed(
        'exam-generation',
        jobId,
        err.message || 'Exam generation failed.',
      );

      // Update Exam status to CANCELLED on failure
      const cancelledStatus = await this.prisma.examStatus.findUnique({
        where: { name: 'CANCELLED' },
      });
      if (cancelledStatus) {
        await this.prisma.exam.update({
          where: { id: examId },
          data: { statusId: cancelledStatus.id },
        }).catch(() => {});
      }
      throw err;
    }
  }
}
