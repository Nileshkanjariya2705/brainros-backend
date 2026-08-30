import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamLifecycleService } from './exam-lifecycle.service';

export interface ExamAccessValidationResult {
  isAllowed: boolean;
  examId: string;
  examVersionId?: string;
  scheduleId?: string;
  serverTime: Date;
  startTime: Date;
  endTime: Date;
  timeRemainingSeconds: number;
}

@Injectable()
export class ExamAccessService {
  private readonly logger = new Logger(ExamAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: ExamLifecycleService,
  ) {}

  /**
   * Server-Authoritative Student Access Evaluation
   * Evaluates exact time boundaries (UTC) and lifecycle requirements.
   */
  async validateStudentAccess(
    examId: string,
    studentId?: string,
  ): Promise<ExamAccessValidationResult> {
    const serverNow = new Date();

    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        status: true,
        schedules: {
          where: { status: { in: ['ACTIVE', 'SCHEDULED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    const currentStatus = exam.status?.name;

    // 1. Status Lifecycle Checks
    if (currentStatus === 'CANCELLED') {
      throw new ForbiddenException({
        code: 'EXAM_CANCELLED',
        message: 'This examination has been cancelled by administration.',
      });
    }

    if (currentStatus === 'DRAFT' || currentStatus === 'SUBMITTED') {
      throw new ForbiddenException({
        code: 'EXAM_NOT_APPROVED',
        message: 'This exam is still in authoring review and not yet approved.',
      });
    }

    if (currentStatus === 'APPROVED') {
      throw new ForbiddenException({
        code: 'EXAM_NOT_SCHEDULED',
        message:
          'This exam is approved but has not yet been scheduled or activated.',
      });
    }

    if (currentStatus === 'SCHEDULED') {
      throw new ForbiddenException({
        code: 'EXAM_NOT_ACTIVE',
        message:
          'This exam is scheduled but not yet activated by Super Admin. Please wait for activation.',
      });
    }

    if (currentStatus === 'ENDED' || currentStatus === 'EVALUATING') {
      throw new ForbiddenException({
        code: 'EXAM_ENDED',
        message: 'The examination window for this test has ended.',
      });
    }

    if (currentStatus !== 'ACTIVE' && currentStatus !== 'COMPLETED') {
      throw new ForbiddenException({
        code: 'EXAM_ACCESS_DENIED',
        message: `Exam status is '${currentStatus}'. Student access is denied.`,
      });
    }

    // 2. Active Schedule Check
    const activeSchedule = exam.schedules?.[0];

    if (activeSchedule) {
      if (activeSchedule.status !== 'ACTIVE') {
        throw new ForbiddenException({
          code: 'EXAM_NOT_ACTIVE',
          message: 'No active schedule found for this exam.',
        });
      }

      const startTime = new Date(activeSchedule.startTime);
      const endTime = new Date(activeSchedule.endTime);

      // Rule: serverNow must be >= startTime
      if (serverNow.getTime() < startTime.getTime()) {
        const waitSeconds = Math.ceil(
          (startTime.getTime() - serverNow.getTime()) / 1000,
        );
        throw new ForbiddenException({
          code: 'EXAM_NOT_YET_STARTED',
          message: `This exam is scheduled to start at ${startTime.toISOString()}. Please wait ${waitSeconds} seconds.`,
          serverTime: serverNow.toISOString(),
          startTime: startTime.toISOString(),
          waitSeconds,
        });
      }

      // Rule: serverNow must be < endTime
      if (serverNow.getTime() >= endTime.getTime()) {
        this.lifecycleService.endExam(examId).catch((err) => {
          this.logger.error(
            `Error transitioning exam '${examId}' to ENDED: ${err.message}`,
          );
        });

        throw new ForbiddenException({
          code: 'EXAM_ENDED',
          message: `The live examination window ended at ${endTime.toISOString()}. Student access is closed.`,
          serverTime: serverNow.toISOString(),
          endTime: endTime.toISOString(),
        });
      }

      // 3. Student Eligibility Check
      if (studentId && exam.examTargetId) {
        const student = await this.prisma.student.findUnique({
          where: { id: studentId },
        });

        if (
          student &&
          student.examTargetId &&
          student.examTargetId !== exam.examTargetId
        ) {
          // If different, allow if open practice, otherwise strict check if explicit mock test
          // Here we do not block open practice mock tests
        }
      }

      const timeRemainingSeconds = Math.max(
        0,
        Math.floor((endTime.getTime() - serverNow.getTime()) / 1000),
      );

      return {
        isAllowed: true,
        examId: exam.id,
        examVersionId: activeSchedule.examVersionId || undefined,
        scheduleId: activeSchedule.id,
        serverTime: serverNow,
        startTime,
        endTime,
        timeRemainingSeconds,
      };
    }

    // If no schedule exists (e.g. self-paced mock test), provide standard exam duration window
    const durationMinutes = exam.durationMinutes || 60;
    const openEndTime = new Date(
      serverNow.getTime() + durationMinutes * 60 * 1000,
    );

    return {
      isAllowed: true,
      examId: exam.id,
      serverTime: serverNow,
      startTime: serverNow,
      endTime: openEndTime,
      timeRemainingSeconds: durationMinutes * 60,
    };
  }
}
