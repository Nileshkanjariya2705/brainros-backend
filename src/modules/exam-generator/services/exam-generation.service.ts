import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlueprintValidationService } from './blueprint-validation.service';
import { QuestionPoolService } from './question-pool.service';
import { ExamRandomizationService } from './exam-randomization.service';
import { ExamSnapshotService } from './exam-snapshot.service';
import { GenerateExamDto, ValidateBlueprintDto } from '../dto/generate-exam.dto';

@Injectable()
export class ExamGenerationService {
  private readonly logger = new Logger(ExamGenerationService.name);
  private static readonly activeGenerations = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: BlueprintValidationService,
    private readonly poolService: QuestionPoolService,
    private readonly randomizationService: ExamRandomizationService,
    private readonly snapshotService: ExamSnapshotService,
  ) {}

  /**
   * Pre-flight validation for a blueprint against current question bank pool
   */
  async validateBlueprintForExam(
    blueprintId: string,
    dto?: ValidateBlueprintDto,
  ) {
    const blueprint = await this.prisma.examBlueprint.findUnique({
      where: { id: blueprintId },
      include: {
        rules: true,
        exam: {
          include: {
            languages: {
              include: { language: true },
            },
          },
        },
      },
    });

    if (!blueprint) {
      throw new NotFoundException(`Blueprint with ID '${blueprintId}' not found`);
    }

    // 1. Resolve exact counts
    const resolvedRules = this.validationService.resolveBlueprintRuleCounts(
      blueprint.totalQuestions,
      blueprint.rules,
    );

    // 2. Extract required language IDs if exam configured languages
    const requiredLangIds =
      dto?.checkLanguages && blueprint.exam.languages.length > 0
        ? blueprint.exam.languages.map((l) => l.languageId)
        : undefined;

    // 3. Validate question pool availability
    const poolResult = await this.poolService.validatePoolAvailability(
      resolvedRules,
      requiredLangIds,
    );

    // 4. Group distributions by subject and difficulty
    const subjectDistribution: Record<string, number> = {};
    const difficultyDistribution: Record<string, number> = {};

    for (const rule of resolvedRules) {
      if (rule.subjectId) {
        const subject = await this.prisma.subject.findUnique({
          where: { id: rule.subjectId },
          select: { name: true },
        });
        const subjName = subject?.name || rule.subjectId;
        subjectDistribution[subjName] =
          (subjectDistribution[subjName] || 0) + rule.requiredCount;
      }
      if (rule.difficultyLevel) {
        difficultyDistribution[rule.difficultyLevel] =
          (difficultyDistribution[rule.difficultyLevel] || 0) + rule.requiredCount;
      }
    }

    return {
      valid: poolResult.isValid,
      totalQuestions: blueprint.totalQuestions,
      subjectDistribution,
      difficultyDistribution,
      questionPool: {
        eligibleTotal: poolResult.totalAvailableEligible,
        requiredTotal: poolResult.totalRequired,
      },
      ruleBreakdown: poolResult.ruleReports,
    };
  }

  /**
   * Generates an immutable ExamVersion with deterministic randomization & snapshotting
   */
  async generateExamVersion(
    blueprintId: string,
    dto: GenerateExamDto,
    generatedById: string,
  ) {
    // Concurrency Lock: Prevent simultaneous generation for the same blueprint/exam
    if (ExamGenerationService.activeGenerations.has(blueprintId)) {
      throw new ConflictException(
        'An exam generation process is already actively running for this blueprint. Please wait.',
      );
    }

    ExamGenerationService.activeGenerations.add(blueprintId);

    try {
      const blueprint = await this.prisma.examBlueprint.findUnique({
        where: { id: blueprintId },
        include: {
          rules: true,
          exam: {
            include: {
              scoringRules: true,
              languages: {
                include: { language: true },
              },
            },
          },
        },
      });

      if (!blueprint) {
        throw new NotFoundException(`Blueprint with ID '${blueprintId}' not found`);
      }

      // 1. Resolve exact counts
      const resolvedRules = this.validationService.resolveBlueprintRuleCounts(
        blueprint.totalQuestions,
        blueprint.rules,
      );

      // 2. Determine generation seed
      const generationSeed = dto.generationSeed || this.randomizationService.generateSeed();

      // 3. Extract exam regional languages
      const languages = blueprint.exam.languages || [];
      const requiredLangIds = languages.map((l) => l.languageId);

      // 4. Select candidate questions according to blueprint rules
      const selectedQuestions = await this.poolService.selectQuestionsForBlueprint(
        resolvedRules,
        generationSeed,
        requiredLangIds.length > 0 ? requiredLangIds : undefined,
      );

      // 5. Persist normalized immutable snapshot
      const examVersion = await this.snapshotService.persistImmutableExamVersionSnapshot({
        exam: blueprint.exam,
        blueprint,
        selectedQuestions,
        generationSeed,
        generatedById,
        languages,
      });

      return {
        examId: examVersion.examId,
        examVersionId: examVersion.id,
        versionNumber: examVersion.versionNumber,
        status: examVersion.status,
        generationSeed: examVersion.generationSeed,
        totalQuestions: examVersion.totalQuestions,
        durationMinutes: examVersion.durationMinutes,
        totalMarks: examVersion.totalMarks,
        generatedAt: examVersion.generatedAt,
      };
    } finally {
      ExamGenerationService.activeGenerations.delete(blueprintId);
    }
  }

  /**
   * Get all generated versions for an exam
   */
  async getExamVersions(examId: string) {
    return this.prisma.examVersion.findMany({
      where: { examId },
      orderBy: { versionNumber: 'desc' },
      include: {
        blueprint: { select: { id: true, name: true, version: true } },
        generatedBy: { select: { id: true, email: true } },
        _count: { select: { questions: true } },
      },
    });
  }

  /**
   * Get specific exam version by ID
   */
  async getExamVersionById(versionId: string) {
    const version = await this.prisma.examVersion.findUnique({
      where: { id: versionId },
      include: {
        exam: { select: { id: true, title: true, examTargetId: true } },
        blueprint: { select: { id: true, name: true, version: true } },
        generatedBy: { select: { id: true, email: true } },
        _count: { select: { questions: true } },
      },
    });

    if (!version) {
      throw new NotFoundException(`Exam version with ID '${versionId}' not found`);
    }

    return version;
  }

  /**
   * Publish an exam version (locks it into immutable production state)
   */
  async publishExamVersion(versionId: string) {
    const version = await this.getExamVersionById(versionId);

    if (version.status === 'PUBLISHED') {
      return version;
    }

    return this.prisma.examVersion.update({
      where: { id: versionId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  /**
   * Retrieve questions for an ExamVersion with presentation in the requested language
   * Reads 100% from immutable snapshot tables without touching mutable Question Bank.
   */
  async getExamVersionQuestions(versionId: string, languageId?: string) {
    const version = await this.getExamVersionById(versionId);

    const questions = await this.prisma.examVersionQuestion.findMany({
      where: { examVersionId: version.id },
      orderBy: { sequenceNumber: 'asc' },
      include: {
        options: {
          orderBy: { displayOrder: 'asc' },
          include: {
            translations: true,
          },
        },
        translations: true,
      },
    });

    // Presentation projection applying translation snapshot fallback
    return questions.map((q) => {
      const activeTranslation = languageId
        ? q.translations.find((t) => t.languageId === languageId)
        : null;

      return {
        id: q.id,
        examVersionId: q.examVersionId,
        sourceQuestionId: q.sourceQuestionId,
        sourceQuestionVersion: q.sourceQuestionVersion,
        sequenceNumber: q.sequenceNumber,
        subjectName: q.subjectName,
        type: q.type,
        difficultyLevel: q.difficultyLevel,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        passage: activeTranslation?.passageText || q.passage,
        assertion: activeTranslation?.assertionText || q.assertion,
        reason: activeTranslation?.reasonText || q.reason,
        questionText: activeTranslation?.questionText || q.questionText,
        explanation: activeTranslation?.explanation || q.explanation,
        options: q.options.map((opt) => {
          const optTr = languageId
            ? opt.translations.find((ot) => ot.languageId === languageId)
            : null;

          return {
            id: opt.id,
            sourceOptionId: opt.sourceOptionId,
            displayOrder: opt.displayOrder,
            optionKey: opt.optionKey,
            optionLabel: opt.optionLabel,
            optionText: optTr?.optionText || opt.optionText,
            isCorrect: opt.isCorrect,
          };
        }),
      };
    });
  }
}
