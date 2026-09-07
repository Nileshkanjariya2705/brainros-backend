import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as ExcelJS from 'exceljs';
import {
  EVALUATION_QUEUE_NAME,
  ResultStatusEnum,
} from '../../result/interfaces/result-lifecycle.interface';

export interface AnswerKeyRowInput {
  questionNumber: number;
  correctOption: string;
  explanation?: string;
}

@Injectable()
export class AnswerKeyService {
  private readonly logger = new Logger(AnswerKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(EVALUATION_QUEUE_NAME)
    private readonly evaluationQueue: Queue,
  ) {}

  /**
   * 1. Get Answer Key Status & Configured Count for a Schedule
   */
  async getAnswerKeyStatus(scheduleId: string) {
    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalQuestions: true,
            status: { select: { name: true } },
          },
        },
        examVersion: {
          include: {
            questions: {
              orderBy: { sequenceNumber: 'asc' },
              include: {
                options: { orderBy: { displayOrder: 'asc' } },
              },
            },
          },
        },
        answerKeyUploadedBy: {
          select: { id: true, email: true, student: { select: { name: true } } },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    const questions = schedule.examVersion?.questions || [];
    const totalQuestions = questions.length || schedule.exam.totalQuestions || 0;

    let configuredKeysCount = 0;
    for (const q of questions) {
      const hasCorrect = q.options?.some((o) => o.isCorrect) || Boolean(q.correctAnswer);
      if (hasCorrect) {
        configuredKeysCount++;
      }
    }

    return {
      scheduleId: schedule.id,
      examId: schedule.examId,
      examTitle: schedule.exam.title,
      scheduleStatus: schedule.status,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      timezone: schedule.timezone,
      hasAnswerKey: schedule.hasAnswerKey,
      answerKeyUploadedAt: schedule.answerKeyUploadedAt,
      answerKeyUploadedBy: schedule.answerKeyUploadedBy
        ? {
            id: schedule.answerKeyUploadedBy.id,
            name:
              schedule.answerKeyUploadedBy.student?.name ||
              schedule.answerKeyUploadedBy.email,
          }
        : null,
      totalQuestions,
      configuredKeysCount,
      isFullyConfigured: totalQuestions > 0 && configuredKeysCount >= totalQuestions,
    };
  }

  /**
   * 2. Generate Answer Key Template (CSV or JSON questions) for a Schedule
   */
  async getAnswerKeyTemplate(scheduleId: string) {
    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        exam: { select: { id: true, title: true } },
        examVersion: {
          include: {
            questions: {
              orderBy: { sequenceNumber: 'asc' },
              include: {
                options: { orderBy: { displayOrder: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    const questions = schedule.examVersion?.questions || [];
    if (questions.length === 0) {
      throw new BadRequestException(
        'This exam version has no registered questions yet. Please upload the question paper first.',
      );
    }

    const rows = questions.map((q) => {
      const correctOpt = q.options.find((o) => o.isCorrect);
      const optKeys = q.options.map((o) => o.optionKey).join('/');
      return {
        questionNumber: q.sequenceNumber,
        subject: q.subjectName || 'General',
        section: q.sectionName || 'Main',
        questionType: q.type,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        availableOptions: optKeys || 'A/B/C/D',
        correctOption: correctOpt?.optionKey || (q.correctAnswer as any)?.key || '',
        explanation: q.explanation || '',
      };
    });

    // Generate CSV string
    const csvHeaders = [
      'Question Number',
      'Subject',
      'Section',
      'Question Type',
      'Marks',
      'Available Options',
      'Correct Option (Required)',
      'Explanation (Optional)',
    ];

    const csvLines = [
      csvHeaders.join(','),
      ...rows.map((r) =>
        [
          r.questionNumber,
          `"${r.subject.replace(/"/g, '""')}"`,
          `"${r.section.replace(/"/g, '""')}"`,
          r.questionType,
          r.marks,
          r.availableOptions,
          `"${r.correctOption}"`,
          `"${r.explanation.replace(/"/g, '""')}"`,
        ].join(','),
      ),
    ];

    return {
      scheduleId: schedule.id,
      examId: schedule.examId,
      examTitle: schedule.exam.title,
      totalQuestions: questions.length,
      csvContent: csvLines.join('\n'),
      questions: rows,
    };
  }

  /**
   * 3. Upload & Validate Answer Key (from CSV buffer or JSON array)
   */
  async uploadAnswerKey(
    scheduleId: string,
    rows: AnswerKeyRowInput[],
    userId: string,
  ) {
    if (!rows || rows.length === 0) {
      throw new BadRequestException('Answer key data cannot be empty.');
    }

    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        exam: { select: { id: true, title: true } },
        examVersion: {
          include: {
            questions: {
              orderBy: { sequenceNumber: 'asc' },
              include: {
                options: { orderBy: { displayOrder: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    const versionQuestions = schedule.examVersion?.questions || [];
    if (versionQuestions.length === 0) {
      throw new BadRequestException(
        'Exam version does not have questions configured yet.',
      );
    }

    const questionBySeq = new Map<number, typeof versionQuestions[0]>();
    for (const q of versionQuestions) {
      questionBySeq.set(q.sequenceNumber, q);
    }

    // Validation pass
    const validationErrors: string[] = [];
    const normalizedEntries: Array<{
      question: typeof versionQuestions[0];
      correctKey: string;
      explanation?: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const qNum = Number(row.questionNumber);
      const correctKey = (row.correctOption || '').trim().toUpperCase();

      if (!qNum || isNaN(qNum)) {
        validationErrors.push(`Row ${i + 1}: Invalid Question Number.`);
        continue;
      }

      const q = questionBySeq.get(qNum);
      if (!q) {
        validationErrors.push(
          `Row ${i + 1}: Question Number ${qNum} does not exist in this exam paper (Total: ${versionQuestions.length}).`,
        );
        continue;
      }

      if (!correctKey) {
        validationErrors.push(
          `Row ${i + 1} (Q#${qNum}): Correct Option is missing.`,
        );
        continue;
      }

      // If single/multiple correct, verify option exists
      if (['SINGLE_CORRECT', 'MULTIPLE_CORRECT'].includes(q.type) && q.options.length > 0) {
        const availableKeys = q.options.map((o) => o.optionKey.toUpperCase());
        // Can be comma-separated for MULTIPLE_CORRECT
        const keysToCheck = correctKey.split(/[\s,;]+/).map((k) => k.trim());
        const invalidKey = keysToCheck.find((k) => !availableKeys.includes(k));
        if (invalidKey) {
          validationErrors.push(
            `Row ${i + 1} (Q#${qNum}): Option '${invalidKey}' is not valid for this question (Options: ${availableKeys.join(', ')}).`,
          );
          continue;
        }
      }

      normalizedEntries.push({
        question: q,
        correctKey,
        explanation: row.explanation?.trim(),
      });
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Answer Key validation failed.',
        errors: validationErrors,
      });
    }

    // Transactional Update
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const entry of normalizedEntries) {
        const { question, correctKey, explanation } = entry;
        const keysList = correctKey.split(/[\s,;]+/).map((k) => k.trim());

        // 1. Update ExamVersionOptions
        for (const opt of question.options) {
          const isCorrect = keysList.includes(opt.optionKey.toUpperCase());
          await tx.examVersionOption.update({
            where: { id: opt.id },
            data: { isCorrect },
          });
        }

        // 2. Update ExamVersionQuestion
        await tx.examVersionQuestion.update({
          where: { id: question.id },
          data: {
            correctAnswer: { key: correctKey, explanation: explanation || null },
            explanation: explanation || question.explanation,
          },
        });

        // 3. Synchronize with underlying Question / QuestionOption / QuestionAnswer
        if (question.sourceQuestionId) {
          const sourceOptions = await tx.questionOption.findMany({
            where: { questionId: question.sourceQuestionId },
          });

          const correctOptionIds: string[] = [];
          for (const sOpt of sourceOptions) {
            const isCorrect = keysList.includes(sOpt.optionKey.toUpperCase());
            await tx.questionOption.update({
              where: { id: sOpt.id },
              data: { isCorrect },
            });
            if (isCorrect) correctOptionIds.push(sOpt.id);
          }

          await tx.questionAnswer.upsert({
            where: { questionId: question.sourceQuestionId },
            update: {
              correctOptionIds: correctOptionIds.length > 0 ? correctOptionIds : undefined,
              numericalAnswer:
                question.type === 'NUMERICAL' && !isNaN(Number(correctKey))
                  ? Number(correctKey)
                  : undefined,
            },
            create: {
              questionId: question.sourceQuestionId,
              answerType: question.type,
              correctOptionIds: correctOptionIds.length > 0 ? correctOptionIds : undefined,
              numericalAnswer:
                question.type === 'NUMERICAL' && !isNaN(Number(correctKey))
                  ? Number(correctKey)
                  : null,
            },
          });

          if (explanation) {
            await tx.questionExplanation.upsert({
              where: { questionId: question.sourceQuestionId },
              update: { explanation },
              create: {
                questionId: question.sourceQuestionId,
                explanation,
              },
            });
          }
        }
      }

      // 4. Mark Schedule as having Answer Key
      await tx.examSchedule.update({
        where: { id: scheduleId },
        data: {
          hasAnswerKey: true,
          answerKeyUploadedAt: now,
          answerKeyUploadedById: userId,
        },
      });
    });

    this.logger.log(
      `[AnswerKeyService] Answer key successfully uploaded for Schedule '${scheduleId}' (Exam: '${schedule.exam.title}'). Configured ${normalizedEntries.length} questions.`,
    );

    // ── Check if exam has already completed / has submitted attempts awaiting evaluation ──
    let enqueuedCount = 0;
    try {
      const eligibleAttempts = await this.prisma.attempt.findMany({
        where: {
          examId: schedule.examId,
          status: { name: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
          OR: [
            { result: null },
            {
              result: {
                resultStatus: {
                  in: [
                    ResultStatusEnum.PENDING_WINDOW_CLOSE,
                    ResultStatusEnum.PROCESSING,
                    ResultStatusEnum.FAILED,
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      });

      if (eligibleAttempts.length > 0) {
        this.logger.log(
          `[AnswerKeyService] Enqueueing ${eligibleAttempts.length} deferred attempts for batch evaluation now that answer key is uploaded.`,
        );

        for (const att of eligibleAttempts) {
          await this.prisma.result.upsert({
            where: { attemptId: att.id },
            update: {
              resultStatus: ResultStatusEnum.PROCESSING,
              metadata: {
                batchEvaluated: true,
                triggeredByAnswerKeyUpload: true,
                enqueuedAt: now.toISOString(),
              },
            },
            create: {
              attemptId: att.id,
              resultStatus: ResultStatusEnum.PROCESSING,
              totalQuestions: 0,
              correctAnswers: 0,
              wrongAnswers: 0,
              unattempted: 0,
              totalScore: 0,
              maxScore: 0,
              percentage: 0,
              accuracy: 0,
              metadata: {
                batchEvaluated: true,
                triggeredByAnswerKeyUpload: true,
                enqueuedAt: now.toISOString(),
              },
            },
          });

          await this.evaluationQueue.add(
            'EVALUATE_ATTEMPT',
            {
              attemptId: att.id,
              triggeredAt: now.toISOString(),
              evaluationMode: 'DEFERRED',
            },
            {
              jobId: `eval_${att.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
              removeOnComplete: true,
            },
          );
          enqueuedCount++;
        }
      }
    } catch (evalErr: any) {
      this.logger.warn(
        `[AnswerKeyService] Deferred evaluation dispatch notice: ${evalErr.message}`,
      );
    }

    return {
      success: true,
      scheduleId,
      examId: schedule.examId,
      examTitle: schedule.exam.title,
      totalQuestions: versionQuestions.length,
      configuredQuestions: normalizedEntries.length,
      uploadedAt: now.toISOString(),
      enqueuedEvaluations: enqueuedCount,
      message:
        enqueuedCount > 0
          ? `Answer key uploaded successfully. Triggered batch evaluation for ${enqueuedCount} pending attempts.`
          : 'Answer key uploaded successfully. Ready for examination evaluation.',
    };
  }

  /**
   * 4. Parse CSV buffer into AnswerKeyRowInput array
   */
  async parseCsvAnswerKey(buffer: Buffer): Promise<AnswerKeyRowInput[]> {
    const text = buffer.toString('utf-8');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length <= 1) {
      throw new BadRequestException('CSV file is empty or has only headers.');
    }

    // Header inspection
    const headerLine = lines[0];
    const headers = this.parseCsvLine(headerLine).map((h) =>
      h.toLowerCase().trim().replace(/[\s_()\-]/g, ''),
    );

    const qNumIdx = headers.findIndex(
      (h) => h.includes('questionnumber') || h === 'qnum' || h === 'q#' || h === 'question',
    );
    const correctOptIdx = headers.findIndex(
      (h) =>
        h.includes('correctoption') ||
        h.includes('correctanswer') ||
        h.includes('answer') ||
        h === 'key',
    );
    const explIdx = headers.findIndex((h) => h.includes('explanation'));

    if (qNumIdx === -1 || correctOptIdx === -1) {
      throw new BadRequestException(
        'CSV must contain "Question Number" and "Correct Option" columns.',
      );
    }

    const rows: AnswerKeyRowInput[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = this.parseCsvLine(lines[i]);
      if (parts.length <= Math.max(qNumIdx, correctOptIdx)) continue;

      const qNum = parseInt(parts[qNumIdx], 10);
      const correctOption = parts[correctOptIdx] || '';
      const explanation = explIdx >= 0 ? parts[explIdx] : undefined;

      if (!isNaN(qNum)) {
        rows.push({
          questionNumber: qNum,
          correctOption,
          explanation,
        });
      }
    }

    return rows;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }
}
