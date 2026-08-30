import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionFilterDto,
  CreateQuestionOptionDto,
  CreateQuestionAnswerDto,
} from './dto/question.dto';
import { QuestionStatus } from './enums/question-status.enum';
import { QuestionTypeEnum } from './enums/question-type.enum';
import { QuestionDifficultyEnum } from './enums/question-difficulty.enum';

@Injectable()
export class QuestionBankService {
  private readonly logger = new Logger(QuestionBankService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════
  // HIERARCHY VALIDATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Validates academic hierarchy integrity:
   * Subject -> Chapter -> Topic -> SubTopic
   */
  async validateHierarchy(
    subjectId: string,
    chapterId: string,
    topicId?: string,
    subTopicId?: string,
  ): Promise<void> {
    // 1. Verify subject exists
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      throw new BadRequestException(
        `Subject with ID '${subjectId}' does not exist.`,
      );
    }

    // 2. Verify chapter exists and belongs to subject
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
    });
    if (!chapter) {
      throw new BadRequestException(
        `Chapter with ID '${chapterId}' does not exist.`,
      );
    }
    if (chapter.subjectId !== subjectId) {
      throw new BadRequestException(
        `Chapter '${chapter.name}' does not belong to the selected Subject '${subject.name}'.`,
      );
    }

    // 3. Verify topic (if provided) belongs to chapter
    if (topicId) {
      const topic = await this.prisma.topic.findUnique({
        where: { id: topicId },
      });
      if (!topic) {
        throw new BadRequestException(
          `Topic with ID '${topicId}' does not exist.`,
        );
      }
      if (topic.chapterId !== chapterId) {
        throw new BadRequestException(
          `Topic '${topic.name}' does not belong to the selected Chapter '${chapter.name}'.`,
        );
      }

      // 4. Verify subTopic (if provided) belongs to topic
      if (subTopicId) {
        const subTopic = await this.prisma.subTopic.findUnique({
          where: { id: subTopicId },
        });
        if (!subTopic) {
          throw new BadRequestException(
            `SubTopic with ID '${subTopicId}' does not exist.`,
          );
        }
        if (subTopic.topicId !== topicId) {
          throw new BadRequestException(
            `SubTopic '${subTopic.name}' does not belong to the selected Topic '${topic.name}'.`,
          );
        }
      }
    } else if (subTopicId) {
      throw new BadRequestException(
        'Cannot assign a SubTopic without selecting a parent Topic.',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUESTION TYPE & ANSWER VALIDATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Validates option and answer structures based on Question Type
   */
  validateQuestionTypeAndAnswer(
    type: QuestionTypeEnum,
    options?: CreateQuestionOptionDto[],
    answer?: CreateQuestionAnswerDto,
    passage?: string,
    assertion?: string,
    reason?: string,
  ): void {
    const opts = options || [];

    switch (type) {
      case QuestionTypeEnum.SINGLE_CORRECT: {
        if (opts.length < 2) {
          throw new BadRequestException(
            'Single Correct MCQ must have at least 2 options.',
          );
        }
        const correctCount = opts.filter((o) => o.isCorrect).length;
        const answerIds = answer?.correctOptionIds || [];
        if (correctCount !== 1 && answerIds.length !== 1) {
          throw new BadRequestException(
            'Single Correct MCQ must have exactly one correct option.',
          );
        }
        break;
      }

      case QuestionTypeEnum.MULTIPLE_CORRECT: {
        if (opts.length < 2) {
          throw new BadRequestException(
            'Multiple Correct MCQ must have at least 2 options.',
          );
        }
        const correctCount = opts.filter((o) => o.isCorrect).length;
        const answerIds = answer?.correctOptionIds || [];
        if (correctCount < 1 && answerIds.length < 1) {
          throw new BadRequestException(
            'Multiple Correct MCQ must have at least one correct option specified.',
          );
        }
        break;
      }

      case QuestionTypeEnum.NUMERICAL: {
        const hasDirectAnswer =
          answer?.numericalAnswer !== undefined &&
          answer.numericalAnswer !== null;
        const hasRange =
          answer?.numericalRangeStart !== undefined &&
          answer?.numericalRangeEnd !== undefined &&
          answer.numericalRangeStart !== null &&
          answer.numericalRangeEnd !== null;

        if (!hasDirectAnswer && !hasRange) {
          throw new BadRequestException(
            'Numerical question must specify a numericalAnswer or a valid range (numericalRangeStart & numericalRangeEnd).',
          );
        }
        break;
      }

      case QuestionTypeEnum.ASSERTION_REASON: {
        if (!assertion?.trim() || !reason?.trim()) {
          throw new BadRequestException(
            'Assertion & Reasoning question requires both assertion and reason statements.',
          );
        }
        if (opts.length < 2) {
          throw new BadRequestException(
            'Assertion & Reasoning question must have options for assertion-reason relationship.',
          );
        }
        break;
      }

      case QuestionTypeEnum.MATCH_FOLLOWING: {
        if (opts.length < 2 && !answer?.matchPairs) {
          throw new BadRequestException(
            'Match the Following question requires column matching options or a matchPairs mapping.',
          );
        }
        break;
      }

      case QuestionTypeEnum.CASE_BASED: {
        if (!passage?.trim()) {
          throw new BadRequestException(
            'Case Based question requires a passage/case study text.',
          );
        }
        break;
      }

      default:
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUESTION CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new question in DRAFT status with translations, options, answer, and explanation
   */
  async createQuestion(dto: CreateQuestionDto, createdById: string) {
    // 1. Hierarchy integrity check
    await this.validateHierarchy(
      dto.subjectId,
      dto.chapterId,
      dto.topicId,
      dto.subTopicId,
    );

    // 2. Determine type and difficulty
    const type = dto.type || QuestionTypeEnum.SINGLE_CORRECT;
    const difficultyLevel =
      dto.difficultyLevel || QuestionDifficultyEnum.MEDIUM;

    // 3. Validate question type rules
    this.validateQuestionTypeAndAnswer(
      type,
      dto.options,
      dto.answer,
      dto.passage,
      dto.assertion,
      dto.reason,
    );

    // 4. Validate translations presence
    if (!dto.translations || dto.translations.length === 0) {
      throw new BadRequestException(
        'At least one translation is required for the question.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // a. Create base Question record
      const question = await tx.question.create({
        data: {
          subjectId: dto.subjectId,
          chapterId: dto.chapterId,
          topicId: dto.topicId || null,
          subTopicId: dto.subTopicId || null,
          difficultyId: dto.difficultyId || null,
          difficultyLevel,
          questionTypeId: dto.questionTypeId || null,
          type,
          status: QuestionStatus.DRAFT,
          version: 1,
          defaultLanguageId: dto.defaultLanguageId,
          marks: dto.marks ?? 4,
          negativeMarks: dto.negativeMarks ?? 1,
          passage: dto.passage || null,
          assertion: dto.assertion || null,
          reason: dto.reason || null,
          correctAnswer: dto.correctAnswer || null,
          createdById,
        },
      });

      // b. Create translations
      await tx.questionTranslation.createMany({
        data: dto.translations.map((t) => ({
          questionId: question.id,
          languageId: t.languageId,
          questionText: t.questionText,
          passageText: t.passageText || null,
          assertionText: t.assertionText || null,
          reasonText: t.reasonText || null,
          explanation: t.explanation || null,
        })),
      });

      // c. Create options and option translations
      const createdOptionsMap: Record<string, string> = {}; // label/key -> id
      const correctOptionIds: string[] = [];

      if (dto.options && dto.options.length > 0) {
        for (let i = 0; i < dto.options.length; i++) {
          const opt = dto.options[i];
          const optionKey = opt.optionKey || String.fromCharCode(65 + i); // 'A', 'B', 'C'...

          const createdOption = await tx.questionOption.create({
            data: {
              questionId: question.id,
              optionKey,
              optionLabel: opt.optionLabel || `Option ${optionKey}`,
              optionText: opt.optionText || null,
              matchColumn: opt.matchColumn || null,
              matchPairKey: opt.matchPairKey || null,
              isCorrect: opt.isCorrect ?? false,
              displayOrder: opt.displayOrder ?? i,
            },
          });

          createdOptionsMap[optionKey] = createdOption.id;
          if (opt.isCorrect) {
            correctOptionIds.push(createdOption.id);
          }

          if (opt.translations && opt.translations.length > 0) {
            await tx.questionOptionTranslation.createMany({
              data: opt.translations.map((ot) => ({
                optionId: createdOption.id,
                languageId: ot.languageId,
                optionText: ot.optionText,
              })),
            });
          }
        }
      }

      // d. Create QuestionAnswer
      const answerPayload = dto.answer;
      const finalCorrectOptionIds =
        answerPayload?.correctOptionIds &&
        answerPayload.correctOptionIds.length > 0
          ? answerPayload.correctOptionIds
          : correctOptionIds;

      await tx.questionAnswer.create({
        data: {
          questionId: question.id,
          answerType: type,
          correctOptionIds:
            finalCorrectOptionIds.length > 0
              ? (finalCorrectOptionIds as any)
              : null,
          numericalAnswer: answerPayload?.numericalAnswer ?? null,
          numericalTolerance: answerPayload?.numericalTolerance ?? 0,
          numericalRangeStart: answerPayload?.numericalRangeStart ?? null,
          numericalRangeEnd: answerPayload?.numericalRangeEnd ?? null,
          matchPairs: answerPayload?.matchPairs || null,
        },
      });

      // e. Create QuestionExplanation
      if (dto.explanation?.explanation) {
        await tx.questionExplanation.create({
          data: {
            questionId: question.id,
            explanation: dto.explanation.explanation,
            mediaUrl: dto.explanation.mediaUrl || null,
          },
        });
      }

      // f. Log creation in QuestionReviewHistory
      await tx.questionReviewHistory.create({
        data: {
          questionId: question.id,
          action: 'CREATED',
          fromStatus: null,
          toStatus: QuestionStatus.DRAFT,
          performedById: createdById,
          comment: 'Question drafted',
        },
      });

      return this.findQuestionByIdWithTx(tx, question.id);
    });
  }

  /**
   * Update question.
   * If question is APPROVED, edits trigger auto-versioning (spawn version N+1 in DRAFT status).
   */
  async updateQuestion(
    id: string,
    dto: UpdateQuestionDto,
    userId: string,
    userRoles: string[] = [],
  ) {
    const existing = await this.findQuestionById(id);

    if (existing.status === QuestionStatus.ARCHIVED) {
      throw new BadRequestException('Archived questions cannot be modified.');
    }

    if (
      existing.status === QuestionStatus.SUBMITTED ||
      existing.status === QuestionStatus.UNDER_REVIEW
    ) {
      const isSuperAdmin = userRoles.includes('SUPER_ADMIN');
      if (!isSuperAdmin && existing.createdById !== userId) {
        throw new BadRequestException(
          'Question is currently under review and cannot be edited by standard administrators.',
        );
      }
    }

    // ─── Versioning Workflow for APPROVED questions ─────────────
    if (existing.status === QuestionStatus.APPROVED) {
      return this.createVersionFromApproved(existing, dto, userId);
    }

    // ─── Standard In-Place Edit for DRAFT or REJECTED questions ──
    const subjectId = dto.subjectId || existing.subjectId;
    const chapterId = dto.chapterId || existing.chapterId;
    const topicId =
      dto.topicId !== undefined ? dto.topicId : existing.topicId || undefined;
    const subTopicId =
      dto.subTopicId !== undefined
        ? dto.subTopicId
        : existing.subTopicId || undefined;

    await this.validateHierarchy(subjectId, chapterId, topicId, subTopicId);

    const type = (dto.type || existing.type) as QuestionTypeEnum;
    const difficultyLevel = (dto.difficultyLevel ||
      existing.difficultyLevel) as QuestionDifficultyEnum;

    this.validateQuestionTypeAndAnswer(
      type,
      dto.options,
      dto.answer,
      dto.passage || existing.passage || undefined,
      dto.assertion || existing.assertion || undefined,
      dto.reason || existing.reason || undefined,
    );

    return this.prisma.$transaction(async (tx) => {
      const newStatus =
        existing.status === QuestionStatus.REJECTED
          ? QuestionStatus.DRAFT
          : existing.status;

      // 1. Update base question
      await tx.question.update({
        where: { id },
        data: {
          subjectId,
          chapterId,
          topicId: topicId || null,
          subTopicId: subTopicId || null,
          difficultyId:
            dto.difficultyId !== undefined
              ? dto.difficultyId
              : existing.difficultyId,
          difficultyLevel,
          questionTypeId:
            dto.questionTypeId !== undefined
              ? dto.questionTypeId
              : existing.questionTypeId,
          type,
          status: newStatus,
          defaultLanguageId:
            dto.defaultLanguageId || existing.defaultLanguageId,
          marks: dto.marks !== undefined ? dto.marks : existing.marks,
          negativeMarks:
            dto.negativeMarks !== undefined
              ? dto.negativeMarks
              : existing.negativeMarks,
          passage: dto.passage !== undefined ? dto.passage : existing.passage,
          assertion:
            dto.assertion !== undefined ? dto.assertion : existing.assertion,
          reason: dto.reason !== undefined ? dto.reason : existing.reason,
          correctAnswer:
            dto.correctAnswer !== undefined
              ? dto.correctAnswer
              : existing.correctAnswer,
          isActive:
            dto.isActive !== undefined ? dto.isActive : existing.isActive,
        },
      });

      // 2. Replace translations if provided
      if (dto.translations) {
        await tx.questionTranslation.deleteMany({ where: { questionId: id } });
        if (dto.translations.length > 0) {
          await tx.questionTranslation.createMany({
            data: dto.translations.map((t) => ({
              questionId: id,
              languageId: t.languageId,
              questionText: t.questionText,
              passageText: t.passageText || null,
              assertionText: t.assertionText || null,
              reasonText: t.reasonText || null,
              explanation: t.explanation || null,
            })),
          });
        }
      }

      // 3. Replace options if provided
      const correctOptionIds: string[] = [];
      if (dto.options) {
        const oldOptions = await tx.questionOption.findMany({
          where: { questionId: id },
          select: { id: true },
        });
        const oldOptionIds = oldOptions.map((o) => o.id);
        if (oldOptionIds.length > 0) {
          await tx.questionOptionTranslation.deleteMany({
            where: { optionId: { in: oldOptionIds } },
          });
        }
        await tx.questionOption.deleteMany({ where: { questionId: id } });

        for (let i = 0; i < dto.options.length; i++) {
          const opt = dto.options[i];
          const optionKey = opt.optionKey || String.fromCharCode(65 + i);

          const createdOption = await tx.questionOption.create({
            data: {
              questionId: id,
              optionKey,
              optionLabel: opt.optionLabel || `Option ${optionKey}`,
              optionText: opt.optionText || null,
              matchColumn: opt.matchColumn || null,
              matchPairKey: opt.matchPairKey || null,
              isCorrect: opt.isCorrect ?? false,
              displayOrder: opt.displayOrder ?? i,
            },
          });

          if (opt.isCorrect) correctOptionIds.push(createdOption.id);

          if (opt.translations && opt.translations.length > 0) {
            await tx.questionOptionTranslation.createMany({
              data: opt.translations.map((ot) => ({
                optionId: createdOption.id,
                languageId: ot.languageId,
                optionText: ot.optionText,
              })),
            });
          }
        }
      }

      // 4. Update Answer
      if (dto.answer || dto.options) {
        const finalCorrectOptionIds =
          dto.answer?.correctOptionIds && dto.answer.correctOptionIds.length > 0
            ? dto.answer.correctOptionIds
            : correctOptionIds;

        await tx.questionAnswer.upsert({
          where: { questionId: id },
          create: {
            questionId: id,
            answerType: type,
            correctOptionIds:
              finalCorrectOptionIds.length > 0
                ? (finalCorrectOptionIds as any)
                : null,
            numericalAnswer: dto.answer?.numericalAnswer ?? null,
            numericalTolerance: dto.answer?.numericalTolerance ?? 0,
            numericalRangeStart: dto.answer?.numericalRangeStart ?? null,
            numericalRangeEnd: dto.answer?.numericalRangeEnd ?? null,
            matchPairs: dto.answer?.matchPairs || null,
          },
          update: {
            answerType: type,
            correctOptionIds:
              finalCorrectOptionIds.length > 0
                ? (finalCorrectOptionIds as any)
                : undefined,
            numericalAnswer:
              dto.answer?.numericalAnswer !== undefined
                ? dto.answer.numericalAnswer
                : undefined,
            numericalTolerance:
              dto.answer?.numericalTolerance !== undefined
                ? dto.answer.numericalTolerance
                : undefined,
            numericalRangeStart:
              dto.answer?.numericalRangeStart !== undefined
                ? dto.answer.numericalRangeStart
                : undefined,
            numericalRangeEnd:
              dto.answer?.numericalRangeEnd !== undefined
                ? dto.answer.numericalRangeEnd
                : undefined,
            matchPairs:
              dto.answer?.matchPairs !== undefined
                ? dto.answer.matchPairs
                : undefined,
          },
        });
      }

      // 5. Update Explanation
      if (dto.explanation?.explanation) {
        await tx.questionExplanation.upsert({
          where: { questionId: id },
          create: {
            questionId: id,
            explanation: dto.explanation.explanation,
            mediaUrl: dto.explanation.mediaUrl || null,
          },
          update: {
            explanation: dto.explanation.explanation,
            mediaUrl:
              dto.explanation.mediaUrl !== undefined
                ? dto.explanation.mediaUrl
                : undefined,
          },
        });
      }

      // 6. Log review history
      await tx.questionReviewHistory.create({
        data: {
          questionId: id,
          action: 'EDITED',
          fromStatus: existing.status,
          toStatus: newStatus,
          performedById: userId,
          comment:
            existing.status === QuestionStatus.REJECTED
              ? 'Modified and returned to draft'
              : 'Question details updated',
        },
      });

      return this.findQuestionByIdWithTx(tx, id);
    });
  }

  /**
   * Helper: spawns a new version of an approved question
   */
  private async createVersionFromApproved(
    parent: any,
    dto: UpdateQuestionDto,
    userId: string,
  ) {
    const nextVersion = parent.version + 1;
    const subjectId = dto.subjectId || parent.subjectId;
    const chapterId = dto.chapterId || parent.chapterId;
    const topicId = dto.topicId !== undefined ? dto.topicId : parent.topicId;
    const subTopicId =
      dto.subTopicId !== undefined ? dto.subTopicId : parent.subTopicId;

    await this.validateHierarchy(subjectId, chapterId, topicId, subTopicId);

    const type = (dto.type || parent.type) as QuestionTypeEnum;
    const difficultyLevel = (dto.difficultyLevel ||
      parent.difficultyLevel) as QuestionDifficultyEnum;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create new Question version
      const newQuestion = await tx.question.create({
        data: {
          subjectId,
          chapterId,
          topicId: topicId || null,
          subTopicId: subTopicId || null,
          difficultyId:
            dto.difficultyId !== undefined
              ? dto.difficultyId
              : parent.difficultyId,
          difficultyLevel,
          questionTypeId:
            dto.questionTypeId !== undefined
              ? dto.questionTypeId
              : parent.questionTypeId,
          type,
          status: QuestionStatus.DRAFT,
          version: nextVersion,
          parentQuestionId: parent.id,
          defaultLanguageId: dto.defaultLanguageId || parent.defaultLanguageId,
          marks: dto.marks !== undefined ? dto.marks : parent.marks,
          negativeMarks:
            dto.negativeMarks !== undefined
              ? dto.negativeMarks
              : parent.negativeMarks,
          passage: dto.passage !== undefined ? dto.passage : parent.passage,
          assertion:
            dto.assertion !== undefined ? dto.assertion : parent.assertion,
          reason: dto.reason !== undefined ? dto.reason : parent.reason,
          correctAnswer:
            dto.correctAnswer !== undefined
              ? dto.correctAnswer
              : parent.correctAnswer,
          createdById: userId,
        },
      });

      // 2. Clone/Update translations
      const translationsToUse = dto.translations || parent.translations;
      if (translationsToUse && translationsToUse.length > 0) {
        await tx.questionTranslation.createMany({
          data: translationsToUse.map((t: any) => ({
            questionId: newQuestion.id,
            languageId: t.languageId,
            questionText: t.questionText,
            passageText: t.passageText || null,
            assertionText: t.assertionText || null,
            reasonText: t.reasonText || null,
            explanation: t.explanation || null,
          })),
        });
      }

      // 3. Clone/Update options
      const optionsToUse = dto.options || parent.options;
      const correctOptionIds: string[] = [];

      if (optionsToUse && optionsToUse.length > 0) {
        for (let i = 0; i < optionsToUse.length; i++) {
          const opt = optionsToUse[i];
          const optionKey = opt.optionKey || String.fromCharCode(65 + i);

          const createdOption = await tx.questionOption.create({
            data: {
              questionId: newQuestion.id,
              optionKey,
              optionLabel: opt.optionLabel || `Option ${optionKey}`,
              optionText: opt.optionText || null,
              matchColumn: opt.matchColumn || null,
              matchPairKey: opt.matchPairKey || null,
              isCorrect: opt.isCorrect ?? false,
              displayOrder: opt.displayOrder ?? i,
            },
          });

          if (opt.isCorrect) correctOptionIds.push(createdOption.id);

          if (opt.translations && opt.translations.length > 0) {
            await tx.questionOptionTranslation.createMany({
              data: opt.translations.map((ot: any) => ({
                optionId: createdOption.id,
                languageId: ot.languageId,
                optionText: ot.optionText,
              })),
            });
          }
        }
      }

      // 4. Clone/Update Answer
      const answerPayload = dto.answer || parent.answer;
      if (answerPayload) {
        await tx.questionAnswer.create({
          data: {
            questionId: newQuestion.id,
            answerType: type,
            correctOptionIds:
              dto.answer?.correctOptionIds ||
              (correctOptionIds.length > 0
                ? (correctOptionIds as any)
                : answerPayload.correctOptionIds),
            numericalAnswer: answerPayload.numericalAnswer ?? null,
            numericalTolerance: answerPayload.numericalTolerance ?? 0,
            numericalRangeStart: answerPayload.numericalRangeStart ?? null,
            numericalRangeEnd: answerPayload.numericalRangeEnd ?? null,
            matchPairs: answerPayload.matchPairs || null,
          },
        });
      }

      // 5. Clone/Update Explanation
      const explanationPayload = dto.explanation || parent.explanation;
      if (explanationPayload?.explanation) {
        await tx.questionExplanation.create({
          data: {
            questionId: newQuestion.id,
            explanation: explanationPayload.explanation,
            mediaUrl: explanationPayload.mediaUrl || null,
          },
        });
      }

      // 6. Log Version Creation
      await tx.questionReviewHistory.create({
        data: {
          questionId: newQuestion.id,
          action: 'VERSION_CREATED',
          fromStatus: QuestionStatus.APPROVED,
          toStatus: QuestionStatus.DRAFT,
          performedById: userId,
          comment: `Version ${nextVersion} created from parent Question ID ${parent.id}`,
        },
      });

      return this.findQuestionByIdWithTx(tx, newQuestion.id);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE WORKFLOW (SUBMIT -> REVIEW -> APPROVE / REJECT / ARCHIVE)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Admin submits question for Super Admin review (DRAFT / REJECTED -> SUBMITTED)
   */
  async submitQuestion(id: string, userId: string, comment?: string) {
    const question = await this.findQuestionById(id);

    if (
      question.status !== QuestionStatus.DRAFT &&
      question.status !== QuestionStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Cannot submit a question with status '${question.status}'. Question must be in DRAFT or REJECTED status.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.question.update({
        where: { id },
        data: {
          status: QuestionStatus.SUBMITTED,
          submittedById: userId,
          submittedAt: new Date(),
        },
      });

      await tx.questionReviewHistory.create({
        data: {
          questionId: id,
          action: 'SUBMITTED',
          fromStatus: question.status,
          toStatus: QuestionStatus.SUBMITTED,
          performedById: userId,
          comment: comment || 'Question submitted for review',
        },
      });

      return this.findQuestionByIdWithTx(tx, id);
    });
  }

  /**
   * Super Admin starts review on submitted question (SUBMITTED -> UNDER_REVIEW)
   */
  async startReview(id: string, reviewerId: string, comment?: string) {
    const question = await this.findQuestionById(id);

    if (question.status !== QuestionStatus.SUBMITTED) {
      throw new BadRequestException(
        `Cannot start review on question with status '${question.status}'. Question must be SUBMITTED first.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id },
        data: {
          status: QuestionStatus.UNDER_REVIEW,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
      });

      await tx.questionReviewHistory.create({
        data: {
          questionId: id,
          action: 'REVIEW_STARTED',
          fromStatus: QuestionStatus.SUBMITTED,
          toStatus: QuestionStatus.UNDER_REVIEW,
          performedById: reviewerId,
          comment: comment || 'Review started by Super Admin',
        },
      });

      return this.findQuestionByIdWithTx(tx, id);
    });
  }

  /**
   * Super Admin approves question (UNDER_REVIEW / SUBMITTED -> APPROVED)
   */
  async approveQuestion(
    id: string,
    approverId: string,
    approverRoles: string[] = [],
    comment?: string,
  ) {
    const question = await this.findQuestionById(id);

    if (
      question.status !== QuestionStatus.UNDER_REVIEW &&
      question.status !== QuestionStatus.SUBMITTED
    ) {
      throw new BadRequestException(
        `Cannot approve question with status '${question.status}'. Question must be UNDER_REVIEW or SUBMITTED.`,
      );
    }

    // Role enforcement: Creator cannot self-approve unless they have SUPER_ADMIN role
    if (
      question.createdById === approverId &&
      !approverRoles.includes('SUPER_ADMIN')
    ) {
      throw new ForbiddenException(
        'Admin creators cannot approve their own questions.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id },
        data: {
          status: QuestionStatus.APPROVED,
          approvedById: approverId,
          approvedAt: new Date(),
          rejectionReason: null,
        },
      });

      await tx.questionReviewHistory.create({
        data: {
          questionId: id,
          action: 'APPROVED',
          fromStatus: question.status,
          toStatus: QuestionStatus.APPROVED,
          performedById: approverId,
          comment:
            comment || 'Question approved and added to active Question Bank',
        },
      });

      return this.findQuestionByIdWithTx(tx, id);
    });
  }

  /**
   * Super Admin rejects question with a rejection reason (UNDER_REVIEW / SUBMITTED -> REJECTED)
   */
  async rejectQuestion(id: string, reviewerId: string, reason: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        'A reason must be provided when rejecting a question.',
      );
    }

    const question = await this.findQuestionById(id);

    if (
      question.status !== QuestionStatus.UNDER_REVIEW &&
      question.status !== QuestionStatus.SUBMITTED
    ) {
      throw new BadRequestException(
        `Cannot reject question with status '${question.status}'. Question must be UNDER_REVIEW or SUBMITTED.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id },
        data: {
          status: QuestionStatus.REJECTED,
          rejectedById: reviewerId,
          rejectedAt: new Date(),
          rejectionReason: reason.trim(),
        },
      });

      await tx.questionReviewHistory.create({
        data: {
          questionId: id,
          action: 'REJECTED',
          fromStatus: question.status,
          toStatus: QuestionStatus.REJECTED,
          performedById: reviewerId,
          comment: `Rejected: ${reason.trim()}`,
        },
      });

      return this.findQuestionByIdWithTx(tx, id);
    });
  }

  /**
   * Archive an approved question (APPROVED -> ARCHIVED)
   */
  async archiveQuestion(id: string, userId: string, reason?: string) {
    const question = await this.findQuestionById(id);

    if (question.status === QuestionStatus.ARCHIVED) {
      throw new BadRequestException('Question is already archived.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id },
        data: {
          status: QuestionStatus.ARCHIVED,
          isActive: false,
        },
      });

      await tx.questionReviewHistory.create({
        data: {
          questionId: id,
          action: 'ARCHIVED',
          fromStatus: question.status,
          toStatus: QuestionStatus.ARCHIVED,
          performedById: userId,
          comment: reason || 'Question archived',
        },
      });

      return { message: 'Question archived successfully' };
    });
  }

  /**
   * Delete question (soft delete or hard delete if draft)
   */
  async deleteQuestion(id: string, userId: string) {
    const question = await this.findQuestionById(id);

    // Check if question is used in any exams
    const usageCount = await this.prisma.examQuestion.count({
      where: { questionId: id },
    });

    if (usageCount > 0) {
      // Must archive instead of hard delete to protect exam attempt history
      return this.archiveQuestion(
        id,
        userId,
        'Archived due to delete request while associated with exams',
      );
    }

    if (question.status === QuestionStatus.APPROVED) {
      return this.archiveQuestion(
        id,
        userId,
        'Approved question archived upon delete',
      );
    }

    // Hard delete unapproved draft/rejected question with no exam linkages
    await this.prisma.question.delete({ where: { id } });
    return { message: 'Question deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUERY & RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════

  /**
   * List questions with full hierarchical filtering, keyword search, status, and pagination
   */
  async findQuestions(filter: QuestionFilterDto) {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(filter.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    // 1. Hierarchy & Subject Target filters
    if (filter.subjectId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filter.subjectId);
      if (isUuid) {
        where.subjectId = filter.subjectId;
      } else {
        const targetSearch = filter.subjectId.trim();
        where.OR = [
          { subject: { name: { contains: targetSearch, mode: 'insensitive' } } },
          { subject: { examTarget: { name: { contains: targetSearch, mode: 'insensitive' } } } },
        ];
      }
    }
    if (filter.chapterId) where.chapterId = filter.chapterId;
    if (filter.topicId) where.topicId = filter.topicId;
    if (filter.subTopicId) where.subTopicId = filter.subTopicId;
    if (filter.examTargetId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filter.examTargetId);
      if (isUuid) {
        where.subject = { examTargetId: filter.examTargetId };
      } else {
        where.subject = {
          examTarget: { name: { contains: filter.examTargetId.trim(), mode: 'insensitive' } },
        };
      }
    }

    // 2. Metadata filters
    if (filter.difficultyId) where.difficultyId = filter.difficultyId;
    if (filter.difficultyLevel) where.difficultyLevel = filter.difficultyLevel;
    if (filter.questionTypeId) where.questionTypeId = filter.questionTypeId;
    if (filter.type) where.type = filter.type;
    if (filter.status) where.status = filter.status;
    if (filter.version) where.version = filter.version;
    if (filter.createdById) where.createdById = filter.createdById;

    // 3. Multilingual keyword search
    if (filter.search?.trim()) {
      const searchTerm = filter.search.trim();
      where.OR = [
        {
          translations: {
            some: {
              questionText: { contains: searchTerm, mode: 'insensitive' },
            },
          },
        },
        { passage: { contains: searchTerm, mode: 'insensitive' } },
        { assertion: { contains: searchTerm, mode: 'insensitive' } },
        { reason: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (filter.languageId) {
      where.translations = {
        some: { languageId: filter.languageId },
      };
    }

    // 4. Safe sorting whitelist
    const allowedSortFields = [
      'createdAt',
      'updatedAt',
      'version',
      'marks',
      'status',
      'difficultyLevel',
    ];
    const sortBy = allowedSortFields.includes(filter.sortBy || '')
      ? filter.sortBy!
      : 'createdAt';
    const sortOrder =
      filter.sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [questions, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          subject: {
            select: {
              id: true,
              name: true,
              examTarget: { select: { id: true, name: true } },
            },
          },
          chapter: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          subTopic: { select: { id: true, name: true } },
          difficulty: { select: { id: true, name: true } },
          questionType: { select: { id: true, name: true, code: true } },
          defaultLanguage: { select: { id: true, name: true } },
          createdBy: {
            select: { id: true, email: true, phone: true, mobileNumber: true },
          },
          submittedBy: { select: { id: true, email: true } },
          approvedBy: { select: { id: true, email: true } },
          translations: {
            include: { language: { select: { id: true, name: true } } },
          },
          options: {
            orderBy: { displayOrder: 'asc' },
            include: {
              translations: {
                include: { language: { select: { id: true, name: true } } },
              },
            },
          },
          answer: true,
          explanation: true,
          _count: { select: { examQuestions: true, childVersions: true } },
        },
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      data: questions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single question by ID with complete relations
   */
  async findQuestionById(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            examTarget: { select: { id: true, name: true } },
          },
        },
        chapter: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
        subTopic: { select: { id: true, name: true } },
        difficulty: { select: { id: true, name: true } },
        questionType: { select: { id: true, name: true, code: true } },
        defaultLanguage: { select: { id: true, name: true } },
        createdBy: { select: { id: true, email: true, phone: true } },
        submittedBy: { select: { id: true, email: true } },
        reviewedBy: { select: { id: true, email: true } },
        approvedBy: { select: { id: true, email: true } },
        rejectedBy: { select: { id: true, email: true } },
        parentQuestion: {
          select: { id: true, version: true, status: true },
        },
        childVersions: {
          select: { id: true, version: true, status: true, createdAt: true },
        },
        translations: {
          include: { language: { select: { id: true, name: true } } },
        },
        options: {
          orderBy: { displayOrder: 'asc' },
          include: {
            translations: {
              include: { language: { select: { id: true, name: true } } },
            },
          },
        },
        answer: true,
        explanation: true,
        reviewHistory: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedBy: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!question)
      throw new NotFoundException(`Question with ID '${id}' not found.`);
    return question;
  }

  /**
   * Get review and audit history for a question
   */
  async getQuestionHistory(id: string) {
    await this.findQuestionById(id);
    return this.prisma.questionReviewHistory.findMany({
      where: { questionId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        performedBy: { select: { id: true, email: true, phone: true } },
      },
    });
  }

  /**
   * Get version history lineage of a question
   */
  async getQuestionVersions(id: string) {
    const question = await this.findQuestionById(id);

    // Find root parent
    const rootId = question.parentQuestionId || question.id;
    const root = await this.prisma.question.findUnique({
      where: { id: rootId },
      include: {
        childVersions: {
          orderBy: { version: 'asc' },
          include: {
            createdBy: { select: { id: true, email: true } },
            approvedBy: { select: { id: true, email: true } },
          },
        },
        createdBy: { select: { id: true, email: true } },
        approvedBy: { select: { id: true, email: true } },
      },
    });

    return {
      currentQuestionId: id,
      rootQuestion: root,
      versions: [root, ...(root?.childVersions || [])],
    };
  }

  /**
   * Question Bank statistical summary grouped by Subject, Difficulty, Type, and Status
   */
  async getQuestionStats(examTargetId?: string) {
    const where: any = {};
    if (examTargetId) {
      where.subject = { examTargetId };
    }

    const [totalQuestions, byStatus, byDifficulty, byType, bySubject] =
      await Promise.all([
        this.prisma.question.count({ where }),
        this.prisma.question.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.question.groupBy({
          by: ['difficultyLevel'],
          where,
          _count: { _all: true },
        }),
        this.prisma.question.groupBy({
          by: ['type'],
          where,
          _count: { _all: true },
        }),
        this.prisma.subject.findMany({
          where: examTargetId ? { examTargetId } : {},
          select: {
            id: true,
            name: true,
            _count: { select: { questions: true } },
          },
        }),
      ]);

    return {
      totalQuestions,
      byStatus: byStatus.reduce(
        (acc, curr) => ({ ...acc, [curr.status]: curr._count._all }),
        {},
      ),
      byDifficulty: byDifficulty.reduce(
        (acc, curr) => ({ ...acc, [curr.difficultyLevel]: curr._count._all }),
        {},
      ),
      byType: byType.reduce(
        (acc, curr) => ({ ...acc, [curr.type]: curr._count._all }),
        {},
      ),
      bySubject: bySubject.map((s) => ({
        subjectId: s.id,
        subjectName: s.name,
        count: s._count.questions,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL HELPER
  // ═══════════════════════════════════════════════════════════════════

  private async findQuestionByIdWithTx(tx: any, id: string) {
    return tx.question.findUnique({
      where: { id },
      include: {
        subject: { select: { id: true, name: true } },
        chapter: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
        subTopic: { select: { id: true, name: true } },
        difficulty: { select: { id: true, name: true } },
        questionType: { select: { id: true, name: true, code: true } },
        defaultLanguage: { select: { id: true, name: true } },
        translations: {
          include: { language: { select: { id: true, name: true } } },
        },
        options: {
          orderBy: { displayOrder: 'asc' },
          include: {
            translations: {
              include: { language: { select: { id: true, name: true } } },
            },
          },
        },
        answer: true,
        explanation: true,
        reviewHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }
}
