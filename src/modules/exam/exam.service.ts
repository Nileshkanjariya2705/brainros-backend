import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CreateExamDto,
  UpdateExamDto,
  GenerateExamQuestionsDto,
  AddExamQuestionsDto,
  ExamFilterDto,
  CreateExamFromTemplateDto,
} from './dto/exam.dto';

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('exam-generation') private readonly examGenerationQueue: Queue,
  ) {}

  /**
   * Create a new exam automatically generated from the predefined target template in background
   */
  async createExamFromTemplate(dto: CreateExamFromTemplateDto, createdById: string) {
    const blueprint = await this.prisma.examBlueprint.findFirst({
      where: {
        isSystem: true,
        exam: { examTargetId: dto.examTargetId },
      },
    });

    if (!blueprint) {
      throw new BadRequestException(
        'No predefined system blueprint found for this exam target type. Seeding might be incomplete.',
      );
    }

    const generatingStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'GENERATING' },
    });
    if (!generatingStatus) {
      throw new BadRequestException('Exam status GENERATING not found. Run seeds.');
    }

    // Default duration & marks per template specifications
    let duration = 120;
    let totalMarks = blueprint.totalQuestions * 4;
    if (blueprint.totalQuestions === 75) {
      duration = 180; // JEE
      totalMarks = 300;
    } else if (blueprint.totalQuestions === 180 || blueprint.totalQuestions === 200) {
      duration = 200; // NEET
      totalMarks = 720; // NEET-UG total marks is 720 (180 questions x 4 marks)
    } else if (blueprint.totalQuestions === 68) {
      duration = 120; // CAT
      totalMarks = 204;
    }

    const exam = await this.prisma.exam.create({
      data: {
        examTargetId: dto.examTargetId,
        title: dto.title,
        description: dto.description || `Generated from ${blueprint.name}`,
        totalQuestions: blueprint.totalQuestions,
        totalMarks,
        durationMinutes: duration,
        defaultMarksPerQuestion: 4,
        defaultNegativeMarks: 1,
        statusId: generatingStatus.id,
        createdById,
      },
    });

    const job = await this.examGenerationQueue.add('generate', {
      examId: exam.id,
      blueprintId: blueprint.id,
      createdById,
    });

    return {
      success: true,
      message: 'Exam generation started in the background.',
      examId: exam.id,
      jobId: job.id,
    };
  }

  /**
   * Create a new exam with sections (starts in DRAFT status)
   */
  async createExam(dto: CreateExamDto, createdById: string) {
    const draftStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'DRAFT' },
    });
    if (!draftStatus)
      throw new BadRequestException('Exam status DRAFT not found. Run seeds.');

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
      throw new BadRequestException(
        'Can only generate questions for DRAFT exams',
      );
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
              `Need ${section.totalQuestions}, available ${questions.length}.`,
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

    const maxOrder = exam.examQuestions.reduce(
      (max, eq) => Math.max(max, eq.displayOrder),
      0,
    );

    let order = maxOrder + 1;
    for (const questionId of dto.questionIds) {
      // Skip if already added
      const exists = exam.examQuestions.find(
        (eq) => eq.questionId === questionId,
      );
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
    const page = filter?.page ? Number(filter.page) : 1;
    const limit = filter?.limit ? Number(filter.limit) : 20;
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
          _count: {
            select: { examQuestions: true, attempts: true, sections: true },
          },
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
   * Get comprehensive Exam details for student view with dynamic access evaluation
   */
  async getExamDetails(id: string, userId?: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        examTarget: { select: { id: true, name: true, description: true } },
        status: { select: { id: true, name: true } },
        createdBy: { select: { id: true, email: true } },
        languages: {
          include: {
            language: {
              select: { id: true, name: true, code: true, nativeName: true },
            },
          },
        },
        schedules: {
          where: { status: { in: ['ACTIVE', 'SCHEDULED', 'ENDED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
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

    if (!exam) throw new NotFoundException(`Exam with ID '${id}' not found`);

    const serverNow = new Date();
    const activeSchedule = exam.schedules?.[0];
    const startTime = activeSchedule?.startTime || exam.startTime || exam.examDate;
    const endTime = activeSchedule?.endTime || exam.endTime;

    let accessStatus = 'AVAILABLE';
    let canStart = true;
    let message = 'Exam is available to attempt.';
    let waitSeconds = 0;
    let existingAttempt: any = null;

    if (userId) {
      const student = await this.prisma.student.findUnique({
        where: { userId },
      });

      if (student) {
        // Check for existing attempt
        const attempt = await this.prisma.attempt.findFirst({
          where: {
            examId: id,
            studentId: student.id,
          },
          orderBy: { createdAt: 'desc' },
          include: {
            status: true,
            result: { select: { id: true, totalScore: true, percentage: true } },
          },
        });

        if (attempt) {
          existingAttempt = {
            id: attempt.id,
            status: attempt.status?.name || 'SUBMITTED',
            createdAt: attempt.createdAt,
            submittedAt: attempt.submittedAt,
            resultId: attempt.result?.id || null,
          };

          const attemptStatusName = attempt.status?.name;
          if (attemptStatusName === 'SUBMITTED' || attemptStatusName === 'EVALUATED' || attemptStatusName === 'COMPLETED') {
            accessStatus = 'ALREADY_ATTEMPTED';
            canStart = false;
            message = 'You have already attempted and submitted this exam.';
          } else if (attemptStatusName === 'IN_PROGRESS') {
            accessStatus = 'IN_PROGRESS';
            canStart = true;
            message = 'You have an active ongoing attempt for this exam.';
          }
        }
      }
    }

    if (accessStatus !== 'ALREADY_ATTEMPTED' && accessStatus !== 'IN_PROGRESS') {
      const statusName = exam.status?.name;

      if (statusName === 'CANCELLED') {
        accessStatus = 'CANCELLED';
        canStart = false;
        message = 'This examination has been cancelled by administration.';
      } else if (statusName === 'ENDED' || statusName === 'COMPLETED') {
        accessStatus = 'ENDED';
        canStart = false;
        message = 'The examination window for this test has closed.';
      } else if (startTime && serverNow.getTime() < new Date(startTime).getTime()) {
        accessStatus = 'NOT_YET_STARTED';
        canStart = false;
        waitSeconds = Math.ceil((new Date(startTime).getTime() - serverNow.getTime()) / 1000);
        message = `This exam will start at ${new Date(startTime).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Kolkata',
        })}.`;
      } else if (endTime && serverNow.getTime() > new Date(endTime).getTime()) {
        accessStatus = 'ENDED';
        canStart = false;
        message = 'The live testing slot for this examination has concluded.';
      }
    }

    return {
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        durationMinutes: exam.durationMinutes,
        defaultMarksPerQuestion: exam.defaultMarksPerQuestion,
        defaultNegativeMarks: exam.defaultNegativeMarks,
        examTarget: exam.examTarget,
        status: exam.status,
        languages: exam.languages.map((l) => l.language || l),
        sections: exam.sections.map((s) => ({
          id: s.id,
          name: s.name,
          displayOrder: s.displayOrder,
          totalQuestions: s.totalQuestions || s._count?.examQuestions || 0,
          marksPerQuestion: exam.defaultMarksPerQuestion,
          negativeMarks: exam.defaultNegativeMarks,
          subject: s.subject,
        })),
        schedule: activeSchedule
          ? {
              id: activeSchedule.id,
              startTime: activeSchedule.startTime,
              endTime: activeSchedule.endTime,
              timezone: activeSchedule.timezone,
              status: activeSchedule.status,
            }
          : null,
      },
      accessDetails: {
        accessStatus,
        canStart,
        message,
        serverTime: serverNow.toISOString(),
        startTime: startTime ? new Date(startTime).toISOString() : null,
        endTime: endTime ? new Date(endTime).toISOString() : null,
        waitSeconds,
        existingAttempt,
      },
    };
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
    if (dto.durationMinutes !== undefined)
      updateData.durationMinutes = dto.durationMinutes;
    if (dto.defaultMarksPerQuestion !== undefined)
      updateData.defaultMarksPerQuestion = dto.defaultMarksPerQuestion;
    if (dto.defaultNegativeMarks !== undefined)
      updateData.defaultNegativeMarks = dto.defaultNegativeMarks;
    if (dto.examDate !== undefined)
      updateData.examDate = new Date(dto.examDate);
    if (dto.startTime !== undefined)
      updateData.startTime = new Date(dto.startTime);
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
        `Exam has ${exam._count.examQuestions} questions but expects ${exam.totalQuestions}`,
      );
    }

    const pendingStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'PENDING_APPROVAL' },
    });
    await this.prisma.exam.update({
      where: { id },
      data: { statusId: pendingStatus!.id },
    });
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

    const approvedStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'APPROVED' },
    });
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

    const activeStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'ACTIVE' },
    });
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

    const completedStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'COMPLETED' },
    });
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
    const cancelledStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'CANCELLED' },
    });
    await this.prisma.exam.update({
      where: { id },
      data: { statusId: cancelledStatus!.id },
    });
    return this.findExamById(id);
  }

  /**
   * Delete exam (supports all statuses with cascading cleanup)
   */
  async deleteExam(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
    });
    if (!exam) throw new NotFoundException('Exam not found');

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete student answers & attempts
      const attempts = await tx.attempt.findMany({
        where: { examId: id },
        select: { id: true },
      });
      const attemptIds = attempts.map((a) => a.id);
      if (attemptIds.length > 0) {
        await tx.questionTimeLog.deleteMany({
          where: { attemptId: { in: attemptIds } },
        });
        await tx.answer.deleteMany({
          where: { attemptId: { in: attemptIds } },
        });
        await tx.attempt.deleteMany({ where: { examId: id } });
      }

      // 2. Delete exam version questions & exam versions
      const versions = await tx.examVersion.findMany({
        where: { examId: id },
        select: { id: true },
      });
      const versionIds = versions.map((v) => v.id);
      if (versionIds.length > 0) {
        await tx.examVersionQuestion.deleteMany({
          where: { examVersionId: { in: versionIds } },
        });
        await tx.examVersion.deleteMany({ where: { examId: id } });
      }

      // 3. Delete blueprint rules & blueprints
      const blueprints = await tx.examBlueprint.findMany({
        where: { examId: id },
        select: { id: true },
      });
      const blueprintIds = blueprints.map((b) => b.id);
      if (blueprintIds.length > 0) {
        await tx.blueprintRule.deleteMany({
          where: { blueprintId: { in: blueprintIds } },
        });
        await tx.examBlueprint.deleteMany({ where: { examId: id } });
      }

      // 4. Delete questions, sections, schedules
      await tx.examQuestion.deleteMany({ where: { examId: id } });
      await tx.examSection.deleteMany({ where: { examId: id } });
      await tx.examSchedule.deleteMany({ where: { examId: id } });

      // 5. Delete the exam record
      await tx.exam.delete({ where: { id } });
      return { message: 'Exam deleted successfully' };
    });
  }

  /**
   * Get exams available for students (ACTIVE status, matching their examTarget).
   * Enriches each exam with the active schedule window (startTime, endTime, timeRemainingSeconds)
   * so the frontend can display real-time countdown information.
   */
  async getAvailableExams(examTargetId: string) {
    const availableStatuses = await this.prisma.examStatus.findMany({
      where: { name: { in: ['ACTIVE', 'SCHEDULED', 'APPROVED', 'COMPLETED'] } },
    });
    const statusIds = availableStatuses.map((s) => s.id);

    const where: any = {
      statusId: { in: statusIds },
    };
    if (
      examTargetId &&
      examTargetId !== 'all' &&
      examTargetId !== 'ALL' &&
      examTargetId !== 'undefined'
    ) {
      where.examTargetId = examTargetId;
    }

    const exams = await this.prisma.exam.findMany({
      where,
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
                Math.floor(
                  (new Date(activeSchedule.endTime).getTime() - now.getTime()) /
                    1000,
                ),
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
              translations: {
                include: {
                  language: { select: { id: true, code: true, name: true } },
                },
              },
              options: {
                orderBy: { displayOrder: 'asc' },
                include: {
                  translations: {
                    include: {
                      language: {
                        select: { id: true, code: true, name: true },
                      },
                    },
                  },
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

    const examDefaultLanguageId = examLanguages.find(
      (el) => el.isDefault,
    )?.languageId;

    return questions.map((eq) => {
      const q = eq.question;

      // 4-Tier Fallback:
      // 1. Attempt Language
      // 2. Exam Default Language
      // 3. Question Default Language
      // 4. First Available Translation
      const matchedTranslation =
        q.translations.find(
          (t) => t.languageId === languageId || t.language?.code === languageId,
        ) ||
        (examDefaultLanguageId
          ? q.translations.find((t) => t.languageId === examDefaultLanguageId)
          : null) ||
        q.translations.find((t) => t.languageId === q.defaultLanguageId) ||
        q.translations[0];

      // Build question translations map for instant client-side switching (indexed by ID & code)
      const qTranslationsMap: Record<
        string,
        {
          questionText: string;
          passageText?: string | null;
          assertionText?: string | null;
          reasonText?: string | null;
        }
      > = {};
      q.translations.forEach((t) => {
        const transObj = {
          questionText: t.questionText,
          passageText: t.passageText || null,
          assertionText: t.assertionText || null,
          reasonText: t.reasonText || null,
        };
        qTranslationsMap[t.languageId] = transObj;
        if (t.language?.code) {
          qTranslationsMap[t.language.code.toLowerCase()] = transObj;
        }
      });

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
        questionText:
          matchedTranslation?.questionText || (q as any).questionText || '',
        translations: qTranslationsMap,
        options: (q.options || []).map((o) => {
          // Option translation fallback
          const matchedOptTranslation =
            o.translations?.find(
              (ot) =>
                ot.languageId === languageId ||
                ot.language?.code === languageId,
            ) ||
            (examDefaultLanguageId
              ? o.translations?.find(
                  (ot) => ot.languageId === examDefaultLanguageId,
                )
              : null) ||
            o.translations?.find(
              (ot) => ot.languageId === q.defaultLanguageId,
            ) ||
            o.translations?.[0];

          const optTranslationsMap: Record<string, { optionText: string }> = {};
          (o.translations || []).forEach((ot) => {
            const optTransObj = {
              optionText: ot.optionText || o.optionText || o.optionLabel || '',
            };
            optTranslationsMap[ot.languageId] = optTransObj;
            if (ot.language?.code) {
              optTranslationsMap[ot.language.code.toLowerCase()] = optTransObj;
            }
          });

          return {
            id: o.id,
            optionKey: o.optionKey,
            optionLabel: o.optionLabel || o.optionKey || '',
            optionText:
              matchedOptTranslation?.optionText ||
              o.optionText ||
              o.optionLabel ||
              o.optionKey ||
              '',
            translations: optTranslationsMap,
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
