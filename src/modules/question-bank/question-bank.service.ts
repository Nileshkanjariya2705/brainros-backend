import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionDto, UpdateQuestionDto, QuestionFilterDto } from './dto/question.dto';

@Injectable()
export class QuestionBankService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new question with translations and options (nested transaction)
   */
  async createQuestion(dto: CreateQuestionDto, createdById: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create the question
      const question = await tx.question.create({
        data: {
          subjectId: dto.subjectId,
          chapterId: dto.chapterId,
          topicId: dto.topicId,
          subTopicId: dto.subTopicId,
          difficultyId: dto.difficultyId,
          questionTypeId: dto.questionTypeId,
          defaultLanguageId: dto.defaultLanguageId,
          correctAnswer: dto.correctAnswer,
          marks: dto.marks ?? 4,
          negativeMarks: dto.negativeMarks ?? 1,
          createdById,
        },
      });

      // 2. Create translations
      if (dto.translations?.length) {
        await tx.questionTranslation.createMany({
          data: dto.translations.map((t) => ({
            questionId: question.id,
            languageId: t.languageId,
            questionText: t.questionText,
            explanation: t.explanation,
          })),
        });
      }

      // 3. Create options with their translations
      for (const opt of dto.options) {
        const option = await tx.questionOption.create({
          data: {
            questionId: question.id,
            optionLabel: opt.optionLabel,
            isCorrect: opt.isCorrect ?? false,
            displayOrder: opt.displayOrder ?? 0,
          },
        });

        if (opt.translations?.length) {
          await tx.questionOptionTranslation.createMany({
            data: opt.translations.map((t) => ({
              optionId: option.id,
              languageId: t.languageId,
              optionText: t.optionText,
            })),
          });
        }
      }

      // 4. Return the fully loaded question
      return this.findQuestionByIdWithTx(tx, question.id);
    });
  }

  /**
   * List questions with filters, search, and pagination
   */
  async findQuestions(filter: QuestionFilterDto) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { isActive: true };
    if (filter.subjectId) where.subjectId = filter.subjectId;
    if (filter.chapterId) where.chapterId = filter.chapterId;
    if (filter.topicId) where.topicId = filter.topicId;
    if (filter.difficultyId) where.difficultyId = filter.difficultyId;
    if (filter.questionTypeId) where.questionTypeId = filter.questionTypeId;
    if (filter.search) {
      where.translations = {
        some: { questionText: { contains: filter.search, mode: 'insensitive' } },
      };
    }

    const [questions, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          subject: { select: { id: true, name: true } },
          chapter: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          difficulty: { select: { id: true, name: true } },
          questionType: { select: { id: true, name: true, code: true } },
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
          _count: { select: { examQuestions: true } },
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
   * Get a single question by ID with all relations
   */
  async findQuestionById(id: string) {
    const question = await this.prisma.question.findUnique({
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
      },
    });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  /**
   * Update a question, its translations, and options
   */
  async updateQuestion(id: string, dto: UpdateQuestionDto) {
    await this.findQuestionById(id);

    return this.prisma.$transaction(async (tx) => {
      // 1. Update base question fields
      const updateData: any = {};
      if (dto.subjectId !== undefined) updateData.subjectId = dto.subjectId;
      if (dto.chapterId !== undefined) updateData.chapterId = dto.chapterId;
      if (dto.topicId !== undefined) updateData.topicId = dto.topicId;
      if (dto.subTopicId !== undefined) updateData.subTopicId = dto.subTopicId;
      if (dto.difficultyId !== undefined) updateData.difficultyId = dto.difficultyId;
      if (dto.questionTypeId !== undefined) updateData.questionTypeId = dto.questionTypeId;
      if (dto.correctAnswer !== undefined) updateData.correctAnswer = dto.correctAnswer;
      if (dto.marks !== undefined) updateData.marks = dto.marks;
      if (dto.negativeMarks !== undefined) updateData.negativeMarks = dto.negativeMarks;
      if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

      if (Object.keys(updateData).length > 0) {
        await tx.question.update({ where: { id }, data: updateData });
      }

      // 2. Replace translations if provided
      if (dto.translations) {
        await tx.questionTranslation.deleteMany({ where: { questionId: id } });
        if (dto.translations.length > 0) {
          await tx.questionTranslation.createMany({
            data: dto.translations.map((t) => ({
              questionId: id,
              languageId: t.languageId,
              questionText: t.questionText,
              explanation: t.explanation,
            })),
          });
        }
      }

      // 3. Replace options if provided
      if (dto.options) {
        // Delete old option translations and options
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

        // Create new options
        for (const opt of dto.options) {
          const option = await tx.questionOption.create({
            data: {
              questionId: id,
              optionLabel: opt.optionLabel,
              isCorrect: opt.isCorrect ?? false,
              displayOrder: opt.displayOrder ?? 0,
            },
          });
          if (opt.translations?.length) {
            await tx.questionOptionTranslation.createMany({
              data: opt.translations.map((t) => ({
                optionId: option.id,
                languageId: t.languageId,
                optionText: t.optionText,
              })),
            });
          }
        }
      }

      return this.findQuestionByIdWithTx(tx, id);
    });
  }

  /**
   * Soft-delete a question
   */
  async deleteQuestion(id: string) {
    await this.findQuestionById(id);
    await this.prisma.question.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Question deleted successfully' };
  }

  /**
   * Get question counts grouped by subject and difficulty for an exam target
   */
  async getQuestionStats(examTargetId: string) {
    const subjects = await this.prisma.subject.findMany({
      where: { examTargetId, isActive: true },
      include: {
        _count: { select: { questions: true } },
        questions: {
          where: { isActive: true },
          select: { difficultyId: true },
        },
      },
    });

    return subjects.map((s) => {
      const difficultyBreakdown: Record<string, number> = {};
      for (const q of s.questions) {
        difficultyBreakdown[q.difficultyId] = (difficultyBreakdown[q.difficultyId] || 0) + 1;
      }
      return {
        subjectId: s.id,
        subjectName: s.name,
        totalQuestions: s._count.questions,
        difficultyBreakdown,
      };
    });
  }

  /**
   * Internal helper: load full question inside a transaction
   */
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
      },
    });
  }
}
