import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateExamDto, UpdateExamDto,
  GenerateExamQuestionsDto, AddExamQuestionsDto,
  ExamFilterDto,
} from './dto/exam.dto';

@Injectable()
export class ExamService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new exam with sections (starts in DRAFT status)
   */
  async createExam(dto: CreateExamDto, createdById: string) {
    const draftStatus = await this.prisma.examStatus.findUnique({ where: { name: 'DRAFT' } });
    if (!draftStatus) throw new BadRequestException('Exam status DRAFT not found. Run seeds.');

    return this.prisma.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          examTargetId: dto.examTargetId,
          title: dto.title,
          description: dto.description,
          totalQuestions: dto.totalQuestions,
          totalMarks: dto.totalMarks,
          durationMinutes: dto.durationMinutes,
          defaultMarksPerQuestion: dto.defaultMarksPerQuestion ?? 4,
          defaultNegativeMarks: dto.defaultNegativeMarks ?? 1,
          statusId: draftStatus.id,
          examDate: dto.examDate ? new Date(dto.examDate) : null,
          startTime: dto.startTime ? new Date(dto.startTime) : null,
          endTime: dto.endTime ? new Date(dto.endTime) : null,
          createdById,
        },
      });

      // Create sections
      if (dto.sections?.length) {
        for (let i = 0; i < dto.sections.length; i++) {
          const section = dto.sections[i];
          await tx.examSection.create({
            data: {
              examId: exam.id,
              subjectId: section.subjectId,
              name: section.name,
              totalQuestions: section.totalQuestions,
              displayOrder: section.displayOrder ?? i + 1,
            },
          });
        }
      }

      return this.loadExam(tx, exam.id);
    });
  }

  /**
   * Auto-generate questions for an exam based on its sections
   * Picks random active questions from the question bank for each subject
   */
  async generateExamQuestions(dto: GenerateExamQuestionsDto) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
      include: {
        status: true,
        sections: { orderBy: { displayOrder: 'asc' } },
        examQuestions: true,
      },
    });

    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'DRAFT') {
      throw new BadRequestException('Can only generate questions for DRAFT exams');
    }

    // Remove existing questions if re-generating
    if (exam.examQuestions.length > 0) {
      await this.prisma.examQuestion.deleteMany({ where: { examId: exam.id } });
    }

    return this.prisma.$transaction(async (tx) => {
      let globalOrder = 1;

      for (const section of exam.sections) {
        // Get random questions for this subject
        const questions = await tx.question.findMany({
          where: {
            subjectId: section.subjectId,
            isActive: true,
          },
          select: { id: true },
        });

        if (questions.length < section.totalQuestions) {
          throw new BadRequestException(
            `Not enough questions for section "${section.name}". ` +
            `Need ${section.totalQuestions}, available ${questions.length}.`
          );
        }

        // Shuffle and pick required count
        const shuffled = questions.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, section.totalQuestions);

        // Create exam questions
        for (const q of selected) {
          await tx.examQuestion.create({
            data: {
              examId: exam.id,
              sectionId: section.id,
              questionId: q.id,
              displayOrder: globalOrder++,
              marks: exam.defaultMarksPerQuestion,
              negativeMarks: exam.defaultNegativeMarks,
            },
          });
        }
      }

      return this.loadExam(tx, exam.id);
    });
  }

  /**
   * Manually add specific questions to an exam section
   */
  async addExamQuestions(dto: AddExamQuestionsDto) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
      include: { status: true, examQuestions: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'DRAFT') {
      throw new BadRequestException('Can only add questions to DRAFT exams');
    }

    const maxOrder = exam.examQuestions.reduce((max, eq) => Math.max(max, eq.displayOrder), 0);

    let order = maxOrder + 1;
    for (const questionId of dto.questionIds) {
      // Skip if already added
      const exists = exam.examQuestions.find((eq) => eq.questionId === questionId);
      if (exists) continue;

      await this.prisma.examQuestion.create({
        data: {
          examId: dto.examId,
          sectionId: dto.sectionId,
          questionId,
          displayOrder: order++,
          marks: exam.defaultMarksPerQuestion,
          negativeMarks: exam.defaultNegativeMarks,
        },
      });
    }

    return this.findExamById(dto.examId);
  }

  /**
   * List exams with filters and pagination
   */
  async findExams(filter: ExamFilterDto) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.examTargetId) where.examTargetId = filter.examTargetId;
    if (filter.status) {
      where.status = { name: filter.status };
    }
    if (filter.search) {
      where.title = { contains: filter.search, mode: 'insensitive' };
    }

    const [exams, total] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          examTarget: { select: { id: true, name: true } },
          status: { select: { id: true, name: true } },
          createdBy: { select: { id: true, email: true } },
          _count: { select: { examQuestions: true, attempts: true, sections: true } },
        },
      }),
      this.prisma.exam.count({ where }),
    ]);

    return {
      data: exams,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get a single exam with all details
   */
  async findExamById(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        createdBy: { select: { id: true, email: true } },
        approvedBy: { select: { id: true, email: true } },
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            subject: { select: { id: true, name: true } },
            _count: { select: { examQuestions: true } },
          },
        },
        _count: { select: { examQuestions: true, attempts: true } },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  /**
   * Update exam metadata (only for DRAFT exams)
   */
  async updateExam(id: string, dto: UpdateExamDto) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'DRAFT') {
      throw new BadRequestException('Can only edit DRAFT exams');
    }

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.durationMinutes !== undefined) updateData.durationMinutes = dto.durationMinutes;
    if (dto.defaultMarksPerQuestion !== undefined) updateData.defaultMarksPerQuestion = dto.defaultMarksPerQuestion;
    if (dto.defaultNegativeMarks !== undefined) updateData.defaultNegativeMarks = dto.defaultNegativeMarks;
    if (dto.examDate !== undefined) updateData.examDate = new Date(dto.examDate);
    if (dto.startTime !== undefined) updateData.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) updateData.endTime = new Date(dto.endTime);

    await this.prisma.exam.update({ where: { id }, data: updateData });
    return this.findExamById(id);
  }

  /**
   * Submit exam for approval (DRAFT → PENDING_APPROVAL)
   */
  async submitForApproval(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { status: true, _count: { select: { examQuestions: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'DRAFT') {
      throw new BadRequestException('Exam must be in DRAFT status');
    }
    if (exam._count.examQuestions === 0) {
      throw new BadRequestException('Exam must have at least one question');
    }
    if (exam._count.examQuestions !== exam.totalQuestions) {
      throw new BadRequestException(
        `Exam has ${exam._count.examQuestions} questions but expects ${exam.totalQuestions}`
      );
    }

    const pendingStatus = await this.prisma.examStatus.findUnique({ where: { name: 'PENDING_APPROVAL' } });
    await this.prisma.exam.update({ where: { id }, data: { statusId: pendingStatus!.id } });
    return this.findExamById(id);
  }

  /**
   * Approve exam (PENDING_APPROVAL → APPROVED)
   */
  async approveExam(id: string, approvedById: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Exam must be in PENDING_APPROVAL status');
    }

    const approvedStatus = await this.prisma.examStatus.findUnique({ where: { name: 'APPROVED' } });
    await this.prisma.exam.update({
      where: { id },
      data: {
        statusId: approvedStatus!.id,
        approvedById,
        approvedAt: new Date(),
      },
    });
    return this.findExamById(id);
  }

  /**
   * Activate exam (APPROVED → ACTIVE) — makes it available for students
   */
  async activateExam(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'APPROVED') {
      throw new BadRequestException('Exam must be APPROVED before activation');
    }

    const activeStatus = await this.prisma.examStatus.findUnique({ where: { name: 'ACTIVE' } });
    await this.prisma.exam.update({
      where: { id },
      data: { statusId: activeStatus!.id, activatedAt: new Date() },
    });
    return this.findExamById(id);
  }

  /**
   * Complete exam (ACTIVE → COMPLETED)
   */
  async completeExam(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'ACTIVE') {
      throw new BadRequestException('Exam must be ACTIVE to complete');
    }

    const completedStatus = await this.prisma.examStatus.findUnique({ where: { name: 'COMPLETED' } });
    await this.prisma.exam.update({
      where: { id },
      data: { statusId: completedStatus!.id },
    });
    return this.findExamById(id);
  }

  /**
   * Cancel exam
   */
  async cancelExam(id: string) {
    const cancelledStatus = await this.prisma.examStatus.findUnique({ where: { name: 'CANCELLED' } });
    await this.prisma.exam.update({
      where: { id },
      data: { statusId: cancelledStatus!.id },
    });
    return this.findExamById(id);
  }

  /**
   * Delete exam (only DRAFT)
   */
  async deleteExam(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { status: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status.name !== 'DRAFT') {
      throw new BadRequestException('Can only delete DRAFT exams');
    }
    await this.prisma.exam.delete({ where: { id } });
    return { message: 'Exam deleted successfully' };
  }

  /**
   * Get exams available for students (ACTIVE status, matching their examTarget).
   * Enriches each exam with the active schedule window (startTime, endTime, timeRemainingSeconds)
   * so the frontend can display real-time countdown information.
   */
  async getAvailableExams(examTargetId: string) {
    const activeStatus = await this.prisma.examStatus.findUnique({ where: { name: 'ACTIVE' } });

    const exams = await this.prisma.exam.findMany({
      where: {
        examTargetId,
        statusId: activeStatus!.id,
      },
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        schedules: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { examQuestions: true, attempts: true } },
      },
      orderBy: { examDate: 'asc' },
    });

    const now = new Date();
    return exams.map((exam) => {
      const activeSchedule = exam.schedules?.[0] ?? null;
      return {
        ...exam,
        schedules: undefined, // strip raw schedules array from response
        activeSchedule: activeSchedule
          ? {
              id: activeSchedule.id,
              startTime: activeSchedule.startTime,
              endTime: activeSchedule.endTime,
              status: activeSchedule.status,
              timeRemainingSeconds: Math.max(
                0,
                Math.floor((new Date(activeSchedule.endTime).getTime() - now.getTime()) / 1000),
              ),
            }
          : null,
      };
    });
  }

  /**
   * Get exam questions for the exam interface (student-facing, no correct answers)
   * Supports multilingual presentation with 4-tier fallback (Attempt Language -> Exam Default -> Question Default -> English)
   */
  async getExamQuestionsForAttempt(examId: string, languageId: string) {
    const [questions, examLanguages] = await Promise.all([
      this.prisma.examQuestion.findMany({
        where: { examId },
        orderBy: { displayOrder: 'asc' },
        include: {
          section: { select: { id: true, name: true, subjectId: true } },
          question: {
            include: {
              questionType: { select: { id: true, name: true, code: true } },
              translations: true,
              options: {
                orderBy: { displayOrder: 'asc' },
                include: {
                  translations: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.examLanguage.findMany({
        where: { examId },
        orderBy: { isDefault: 'desc' },
      }),
    ]);

    const examDefaultLanguageId = examLanguages.find((el) => el.isDefault)?.languageId;

    return questions.map((eq) => {
      const q = eq.question;

      // 4-Tier Fallback:
      // 1. Attempt Language
      // 2. Exam Default Language
      // 3. Question Default Language
      // 4. First Available Translation
      const matchedTranslation =
        q.translations.find((t) => t.languageId === languageId) ||
        (examDefaultLanguageId ? q.translations.find((t) => t.languageId === examDefaultLanguageId) : null) ||
        q.translations.find((t) => t.languageId === q.defaultLanguageId) ||
        q.translations[0];

      return {
        examQuestionId: eq.id,
        questionId: q.id,
        displayOrder: eq.displayOrder,
        marks: eq.marks,
        negativeMarks: eq.negativeMarks,
        section: eq.section,
        type: q.type,
        questionType: q.questionType,
        passage: matchedTranslation?.passageText || q.passage || null,
        assertion: matchedTranslation?.assertionText || q.assertion || null,
        reason: matchedTranslation?.reasonText || q.reason || null,
        questionText: matchedTranslation?.questionText ?? '',
        options: q.options.map((o) => {
          // Option translation fallback
          const matchedOptTranslation =
            o.translations.find((ot) => ot.languageId === languageId) ||
            (examDefaultLanguageId ? o.translations.find((ot) => ot.languageId === examDefaultLanguageId) : null) ||
            o.translations.find((ot) => ot.languageId === q.defaultLanguageId) ||
            o.translations[0];

          return {
            id: o.id,
            optionKey: o.optionKey,
            optionLabel: o.optionLabel,
            optionText: matchedOptTranslation?.optionText || o.optionText || o.optionLabel || '',
            matchColumn: o.matchColumn,
            matchPairKey: o.matchPairKey,
            displayOrder: o.displayOrder,
            // isCorrect is EXCLUDED from student-facing API
          };
        }),
      };
    });
  }


  /**
   * Internal helper to load full exam
   */
  private async loadExam(tx: any, id: string) {
    return tx.exam.findUnique({
      where: { id },
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            subject: { select: { id: true, name: true } },
            _count: { select: { examQuestions: true } },
          },
        },
        _count: { select: { examQuestions: true } },
      },
    });
  }
}
