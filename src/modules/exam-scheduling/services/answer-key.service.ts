import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
          include: {
            status: { select: { name: true } },
            examTarget: { select: { id: true, name: true } },
            examQuestions: {
              include: {
                question: {
                  include: {
                    options: true,
                    answer: true,
                  },
                },
              },
            },
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

    const studentAttemptsCount = await this.prisma.attempt.count({
      where: { examId: schedule.examId },
    });

    const versionQuestions = schedule.examVersion?.questions || [];
    let configuredKeysCount = 0;
    let totalQuestions = 0;

    if (versionQuestions.length > 0) {
      totalQuestions = versionQuestions.length;
      for (const q of versionQuestions) {
        const hasCorrect = q.options?.some((o) => o.isCorrect) || Boolean(q.correctAnswer);
        if (hasCorrect) {
          configuredKeysCount++;
        }
      }
    } else if (schedule.exam?.examQuestions && schedule.exam.examQuestions.length > 0) {
      totalQuestions = schedule.exam.examQuestions.length;
      for (const eq of schedule.exam.examQuestions) {
        const q = eq.question;
        const correctIds = Array.isArray(q.answer?.correctOptionIds)
          ? (q.answer.correctOptionIds as string[])
          : [];
        const hasCorrect =
          q.options?.some((o) => o.isCorrect) ||
          correctIds.length > 0 ||
          (q.answer?.numericalAnswer !== null && q.answer?.numericalAnswer !== undefined);
        if (hasCorrect) {
          configuredKeysCount++;
        }
      }
    } else {
      totalQuestions = schedule.exam?.totalQuestions || 0;
    }

    const isCompleted =
      schedule.status === 'ENDED' ||
      (schedule.endTime ? new Date(schedule.endTime) <= new Date() : false);

    const titleUpper = (schedule.exam?.title || '').toUpperCase();
    const isMock = titleUpper.includes('MOCK') || titleUpper.includes('PRACTICE');

    return {
      scheduleId: schedule.id,
      examId: schedule.examId,
      examTitle: schedule.exam.title,
      examTarget: schedule.exam.examTarget?.name || 'General',
      examType: isMock ? 'MOCK' : 'LIVE',
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
      studentAttemptsCount,
      isCompleted,
      isLive: !isMock,
    };
  }

  /**
   * 2. Generate Answer Key Template (CSV or JSON questions) for a Schedule
   */
  async getAnswerKeyTemplate(scheduleId: string) {
    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        exam: {
          include: {
            examQuestions: {
              orderBy: { displayOrder: 'asc' },
              include: {
                question: {
                  include: {
                    subject: { select: { id: true, name: true } },
                    chapter: { select: { id: true, name: true } },
                    options: { orderBy: { displayOrder: 'asc' } },
                    answer: true,
                    explanation: true,
                    translations: true,
                  },
                },
              },
            },
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
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    const versionQuestions = schedule.examVersion?.questions || [];
    let rows: any[] = [];

    if (versionQuestions.length > 0) {
      rows = versionQuestions.map((q) => {
        const correctOpt = q.options.find((o) => o.isCorrect);
        const optKeys = q.options.map((o) => o.optionKey).join('/');
        let correctVal = correctOpt?.optionKey || '';
        if (!correctVal && q.correctAnswer) {
          if (typeof q.correctAnswer === 'object' && (q.correctAnswer as any).key) {
            correctVal = (q.correctAnswer as any).key;
          } else if (typeof q.correctAnswer === 'string') {
            correctVal = q.correctAnswer;
          }
        }

        return {
          questionId: q.id,
          questionNumber: q.sequenceNumber,
          subject: q.subjectName || 'General',
          section: q.sectionName || 'Main',
          questionType: q.type,
          questionText: q.questionText,
          passageText: q.passage,
          assertionText: q.assertion,
          reasonText: q.reason,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          availableOptions: optKeys || 'A/B/C/D',
          correctOption: correctVal,
          explanation: q.explanation || '',
          options: q.options.map((o) => ({
            id: o.id,
            optionKey: o.optionKey,
            optionLabel: o.optionLabel || o.optionKey,
            optionText: o.optionText || '',
            isCorrect: o.isCorrect,
            displayOrder: o.displayOrder,
          })),
        };
      });
    } else if (schedule.exam?.examQuestions && schedule.exam.examQuestions.length > 0) {
      rows = schedule.exam.examQuestions.map((eq, idx) => {
        const q = eq.question;
        const correctOpt = q.options.find((o) => o.isCorrect);
        const optKeys = q.options.map((o) => o.optionKey).join('/');
        let correctVal = correctOpt?.optionKey || '';
        const correctIds = Array.isArray(q.answer?.correctOptionIds)
          ? (q.answer.correctOptionIds as string[])
          : [];
        if (!correctVal && correctIds.length > 0) {
          const matchOpt = q.options.find((o) => correctIds.includes(o.id));
          if (matchOpt) correctVal = matchOpt.optionKey;
        }
        if (!correctVal && q.answer?.numericalAnswer !== undefined && q.answer?.numericalAnswer !== null) {
          correctVal = String(q.answer.numericalAnswer);
        }

        return {
          questionId: q.id,
          questionNumber: idx + 1,
          subject: q.subject?.name || 'General',
          chapter: q.chapter?.name || null,
          section: 'Main',
          questionType: q.type,
          questionText: q.translations?.[0]?.questionText || (q as any).questionText || '',
          passageText: q.passage,
          assertionText: q.assertion,
          reasonText: q.reason,
          marks: eq.marks ?? q.marks,
          negativeMarks: eq.negativeMarks ?? q.negativeMarks,
          availableOptions: optKeys || 'A/B/C/D',
          correctOption: correctVal,
          explanation: q.explanation?.explanation || (q as any).explanation || '',
          options: (q.options || []).map((o) => ({
            id: o.id,
            optionKey: o.optionKey,
            optionLabel: o.optionKey,
            optionText: o.optionText || '',
            isCorrect: o.isCorrect || (correctOpt?.id === o.id),
            displayOrder: o.displayOrder,
          })),
        };
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        'This exam has no registered questions yet. Please upload the question paper first.',
      );
    }

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
          `"${(r.subject || 'General').replace(/"/g, '""')}"`,
          `"${(r.section || 'Main').replace(/"/g, '""')}"`,
          r.questionType,
          r.marks,
          r.availableOptions,
          `"${r.correctOption}"`,
          `"${(r.explanation || '').replace(/"/g, '""')}"`,
        ].join(','),
      ),
    ];

    return {
      scheduleId: schedule.id,
      examId: schedule.examId,
      examTitle: schedule.exam.title,
      examTarget: (schedule.exam as any).examTarget?.name || (schedule.exam as any).examTarget || null,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      durationMinutes: (schedule.exam as any).durationMinutes || 0,
      totalMarks: (schedule.exam as any).totalMarks || 0,
      hasAnswerKey: schedule.hasAnswerKey,
      answerKeyUploadedAt: schedule.answerKeyUploadedAt,
      totalQuestions: rows.length,
      csvContent: csvLines.join('\n'),
      questions: rows,
    };
  }

  /**
   * 3. Upload & Validate Answer Key (from CSV buffer or JSON array)
   * Operators may only upload keys for COMPLETED / ENDED exams.
   */
  async uploadAnswerKey(
    scheduleId: string,
    rows: AnswerKeyRowInput[],
    userId: string,
    userRoles: string[] = [],
  ) {
    if (!rows || rows.length === 0) {
      throw new BadRequestException('Answer key data cannot be empty.');
    }

    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            examTarget: { select: { name: true } },
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
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    // ─── 1. Universal Eligibility Check: Cannot upload answer key before completing exam ───
    const scheduleStatus = (schedule as any).status;
    const endTime: Date | null = schedule.endTime ? new Date(schedule.endTime) : null;
    const currentTime = new Date();
    const isCompleted =
      scheduleStatus === 'COMPLETED' ||
      scheduleStatus === 'ENDED' ||
      (endTime !== null && endTime <= currentTime);

    if (!isCompleted) {
      throw new BadRequestException(
        'Cannot upload answer key before completing exam.',
      );
    }

    // ─── 2. Workflow Check: Must be an official/live exam (Not a Mock Test) ───
    const examTitleUpper = (schedule.exam.title || '').toUpperCase();
    const isMockExam = examTitleUpper.includes('MOCK') || examTitleUpper.includes('PRACTICE');
    if (isMockExam) {
      throw new BadRequestException(
        'Mock Tests are evaluated immediately on student submission and do not use the official answer-key upload workflow.',
      );
    }

    // ─── 3. Immutability Guard: Answer key cannot be modified while evaluation is running ───
    const activeProcessingCount = await this.prisma.result.count({
      where: {
        attempt: { examId: schedule.examId },
        resultStatus: ResultStatusEnum.PROCESSING,
      },
    });

    if (activeProcessingCount > 0) {
      throw new BadRequestException(
        'Evaluation is actively in progress for this exam. Answer key cannot be modified while evaluation is running.',
      );
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
    const seenQNums = new Set<number>();
    const normalizedEntries: Array<{
      question: typeof versionQuestions[0];
      correctKey: string;
      explanation?: string;
    }> = [];

    // 1. Check for duplicates, extras, and invalid answers per row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const qNum = Number(row.questionNumber);
      const rawCorrect = (row.correctOption || '').trim();
      const correctKey = rawCorrect.toUpperCase();

      if (!qNum || isNaN(qNum)) {
        validationErrors.push(`Invalid Question Number at row ${i + 1}.`);
        continue;
      }

      if (seenQNums.has(qNum)) {
        validationErrors.push(`Duplicate question number: ${qNum}`);
        continue;
      }
      seenQNums.add(qNum);

      const q = questionBySeq.get(qNum);
      if (!q) {
        validationErrors.push(`Question number ${qNum} does not exist in this exam.`);
        continue;
      }

      if (!correctKey) {
        validationErrors.push(`Missing answer for question number: ${qNum}`);
        continue;
      }

      // Check question type compatibility
      if (q.type === 'NUMERICAL') {
        if (isNaN(Number(rawCorrect))) {
          validationErrors.push(`Question ${qNum} requires a numerical answer.`);
          continue;
        }
      } else if (q.type === 'SINGLE_CORRECT') {
        if (correctKey.includes('|') || correctKey.includes(',') || correctKey.includes(';')) {
          validationErrors.push(
            `Question ${qNum} is a single-choice question and accepts only one option.`,
          );
          continue;
        }
        const availableKeys = (q.options || []).map((o) => o.optionKey.toUpperCase());
        if (availableKeys.length > 0 && !availableKeys.includes(correctKey)) {
          validationErrors.push(`Invalid answer '${rawCorrect}' for question ${qNum}.`);
          continue;
        }
      } else if (q.type === 'MULTIPLE_CORRECT') {
        const availableKeys = (q.options || []).map((o) => o.optionKey.toUpperCase());
        const keysToCheck = correctKey
          .split(/[\s,|;]+/)
          .map((k) => k.trim())
          .filter(Boolean);
        const invalidKey = keysToCheck.find((k) => !availableKeys.includes(k));
        if (invalidKey) {
          validationErrors.push(`Invalid answer '${invalidKey}' for question ${qNum}.`);
          continue;
        }
      }

      normalizedEntries.push({
        question: q,
        correctKey: q.type === 'MULTIPLE_CORRECT'
          ? correctKey.split(/[\s,|;]+/).map((k) => k.trim()).sort().join('|')
          : rawCorrect,
        explanation: row.explanation?.trim(),
      });
    }

    // 2. Check for missing question numbers from the ExamVersion
    for (const q of versionQuestions) {
      if (!seenQNums.has(q.sequenceNumber)) {
        validationErrors.push(`Missing answer for question number: ${q.sequenceNumber}`);
      }
    }

    // 3. Check total question count matches ExamVersion exactly
    if (rows.length !== versionQuestions.length && validationErrors.length === 0) {
      validationErrors.push(
        `Exam version requires ${versionQuestions.length} answers, but received ${rows.length}.`,
      );
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: validationErrors[0],
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

      // 5. Update or Initialize ExamResultPublication as PROCESSING
      const existingPub = await tx.examResultPublication.findFirst({
        where: { examId: schedule.examId },
        orderBy: { publicationVersion: 'desc' },
      });
      const publicationVersion = existingPub ? existingPub.publicationVersion : 1;

      await tx.examResultPublication.upsert({
        where: {
          examId_publicationVersion: {
            examId: schedule.examId,
            publicationVersion,
          },
        },
        update: {
          status: 'PROCESSING',
        },
        create: {
          examId: schedule.examId,
          examVersionId: schedule.examVersionId,
          status: 'PROCESSING',
          publicationVersion: 1,
        },
      });

      // 6. Record Audit Log
      try {
        await tx.securityEvent.create({
          data: {
            userId,
            eventType: 'ROLE_CHANGED' as any,
            ipAddress: 'server-internal',
            metadata: {
              action: 'ANSWER_KEY_UPLOADED',
              scheduleId,
              examId: schedule.examId,
              examTitle: schedule.exam.title,
              configuredQuestions: normalizedEntries.length,
              uploadedAt: now.toISOString(),
            },
          },
        });
      } catch {
        // Non-blocking audit log fallback
      }
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
        'CSV must contain "question_number" and "correct_answer" columns.',
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

  /**
   * 5. Parse Excel (.xlsx/.xls) buffer into AnswerKeyRowInput array
   */
  async parseExcelAnswerKey(buffer: Buffer): Promise<AnswerKeyRowInput[]> {
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('Excel file does not contain any worksheets.');
    }

    let qNumCol = -1;
    let correctOptCol = -1;
    let explCol = -1;
    const rows: AnswerKeyRowInput[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell, colNumber) => {
          const val = String(cell.value || '')
            .toLowerCase()
            .trim()
            .replace(/[\s_()\-]/g, '');
          if (
            val.includes('questionnumber') ||
            val === 'qnum' ||
            val === 'q#' ||
            val === 'question'
          ) {
            qNumCol = colNumber;
          } else if (
            val.includes('correctanswer') ||
            val.includes('correctoption') ||
            val.includes('answer') ||
            val === 'key'
          ) {
            correctOptCol = colNumber;
          } else if (val.includes('explanation')) {
            explCol = colNumber;
          }
        });
      } else {
        if (qNumCol === -1 || correctOptCol === -1) return;
        const qNumVal = row.getCell(qNumCol).value;
        const correctOptVal = row.getCell(correctOptCol).value;
        const explVal = explCol >= 0 ? row.getCell(explCol).value : undefined;

        if (qNumVal !== null && qNumVal !== undefined) {
          const qNum = parseInt(String(qNumVal).trim(), 10);
          if (!isNaN(qNum)) {
            rows.push({
              questionNumber: qNum,
              correctOption: String(correctOptVal ?? '').trim(),
              explanation: explVal ? String(explVal).trim() : undefined,
            });
          }
        }
      }
    });

    if (qNumCol === -1 || correctOptCol === -1) {
      throw new BadRequestException(
        'Excel file must contain "question_number" and "correct_answer" columns.',
      );
    }

    if (rows.length === 0) {
      throw new BadRequestException('Excel file has no data rows.');
    }

    return rows;
  }

  /**
   * 6. Generate Generic Sample CSV Template
   */
  generateSampleCsv(): string {
    return [
      'question_number,correct_answer',
      '1,A',
      '2,B',
      '3,D',
      '4,C',
      '5,A',
      '6,B',
      '7,C',
      '8,D',
      '9,A',
      '10,B',
    ].join('\n');
  }

  /**
   * 7. Generate Generic Sample Excel Template
   */
  async generateSampleExcel(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Answer Key Template');
    worksheet.columns = [
      { header: 'question_number', key: 'question_number', width: 20 },
      { header: 'correct_answer', key: 'correct_answer', width: 20 },
    ];
    const samples = [
      [1, 'A'],
      [2, 'B'],
      [3, 'D'],
      [4, 'C'],
      [5, 'A'],
      [6, 'B'],
      [7, 'C'],
      [8, 'D'],
      [9, 'A'],
      [10, 'B'],
    ];
    samples.forEach(([qNum, ans]) => {
      worksheet.addRow({ question_number: qNum, correct_answer: ans });
    });
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
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
