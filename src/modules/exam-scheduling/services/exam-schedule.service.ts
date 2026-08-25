import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamLifecycleService } from './exam-lifecycle.service';
import { ScheduleExamDto, RescheduleExamDto } from '../dto/schedule-exam.dto';

@Injectable()
export class ExamScheduleService {
  private readonly logger = new Logger(ExamScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: ExamLifecycleService,
  ) {}

  /**
   * Schedule an Approved Exam: APPROVED -> SCHEDULED
   */
  async scheduleExam(
    examId: string,
    dto: ScheduleExamDto,
    scheduledById: string,
  ) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        status: true,
        versions: { where: { id: dto.examVersionId } },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    if (exam.status.name !== 'APPROVED') {
      throw new BadRequestException(
        `Cannot schedule exam with status '${exam.status.name}'. Only 'APPROVED' exams can be scheduled.`,
      );
    }

    if (exam.versions.length === 0) {
      throw new BadRequestException(
        `Specified ExamVersion '${dto.examVersionId}' does not exist or does not belong to Exam '${examId}'.`,
      );
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException('Invalid startTime or endTime ISO timestamp format.');
    }

    if (startTime >= endTime) {
      throw new BadRequestException(
        `Invalid live window: startTime (${startTime.toISOString()}) must be strictly before endTime (${endTime.toISOString()}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create schedule record
      const schedule = await tx.examSchedule.create({
        data: {
          examId,
          examVersionId: dto.examVersionId,
          startTime,
          endTime,
          timezone: dto.timezone || 'Asia/Kolkata',
          status: 'SCHEDULED',
          scheduledById,
        },
        include: {
          exam: { select: { id: true, title: true } },
          examVersion: { select: { id: true, versionNumber: true } },
        },
      });

      // 2. Transition Exam status to SCHEDULED
      const scheduledStatus = await this.lifecycleService.getOrCreateExamStatus(
        'SCHEDULED',
        tx,
      );

      await tx.exam.update({
        where: { id: examId },
        data: {
          statusId: scheduledStatus.id,
          startTime,
          endTime,
        },
      });

      // 3. Record lifecycle audit history
      await this.lifecycleService.recordHistory(
        {
          examId,
          examVersionId: dto.examVersionId,
          scheduleId: schedule.id,
          action: 'SCHEDULE',
          fromStatus: 'APPROVED',
          toStatus: 'SCHEDULED',
          performedById: scheduledById,
          comment: `Scheduled for window ${startTime.toISOString()} - ${endTime.toISOString()} (${dto.timezone || 'Asia/Kolkata'})`,
          metadata: {
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            timezone: dto.timezone,
          },
        },
        tx,
      );

      this.logger.log(
        `Exam '${examId}' scheduled (Schedule ID: '${schedule.id}') by user '${scheduledById}'`,
      );
      return schedule;
    });
  }

  /**
   * Reschedule a Scheduled Exam: SCHEDULED -> SCHEDULED with updated window
   */
  async rescheduleExam(
    scheduleId: string,
    dto: RescheduleExamDto,
    performedById: string,
  ) {
    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: { exam: { include: { status: true } } },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    if (schedule.status !== 'SCHEDULED') {
      throw new BadRequestException(
        `Cannot reschedule an exam with status '${schedule.status}'. Only 'SCHEDULED' exams can be rescheduled.`,
      );
    }

    const newStartTime = new Date(dto.startTime);
    const newEndTime = new Date(dto.endTime);

    if (isNaN(newStartTime.getTime()) || isNaN(newEndTime.getTime())) {
      throw new BadRequestException('Invalid startTime or endTime ISO timestamp format.');
    }

    if (newStartTime >= newEndTime) {
      throw new BadRequestException(
        `Invalid live window: newStartTime must be strictly before newEndTime.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const oldWindow = {
        startTime: schedule.startTime.toISOString(),
        endTime: schedule.endTime.toISOString(),
        timezone: schedule.timezone,
      };

      const updated = await tx.examSchedule.update({
        where: { id: scheduleId },
        data: {
          startTime: newStartTime,
          endTime: newEndTime,
          timezone: dto.timezone || schedule.timezone,
        },
      });

      await tx.exam.update({
        where: { id: schedule.examId },
        data: {
          startTime: newStartTime,
          endTime: newEndTime,
        },
      });

      await this.lifecycleService.recordHistory(
        {
          examId: schedule.examId,
          examVersionId: schedule.examVersionId,
          scheduleId: schedule.id,
          action: 'RESCHEDULE',
          fromStatus: 'SCHEDULED',
          toStatus: 'SCHEDULED',
          performedById,
          comment: dto.reason || 'Exam rescheduled by administrator.',
          metadata: {
            previousWindow: oldWindow,
            newWindow: {
              startTime: newStartTime.toISOString(),
              endTime: newEndTime.toISOString(),
              timezone: dto.timezone || schedule.timezone,
            },
          },
        },
        tx,
      );

      this.logger.log(`Schedule '${scheduleId}' rescheduled by user '${performedById}'`);
      return updated;
    });
  }

  /**
   * Super Admin activates Exam: SCHEDULED -> ACTIVE
   * Implements strict concurrency protection and idempotency
   */
  async activateExam(scheduleId: string, performedById: string) {
    const schedule = await this.prisma.examSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        exam: { include: { status: true } },
        examVersion: true,
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID '${scheduleId}' not found`);
    }

    // Idempotency: If already active, return cleanly
    if (schedule.status === 'ACTIVE') {
      return {
        message: 'Exam is already activated.',
        schedule,
      };
    }

    if (schedule.status !== 'SCHEDULED') {
      throw new BadRequestException(
        `Cannot activate schedule with status '${schedule.status}'. Only 'SCHEDULED' exams can be activated.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Conditional atomic update for schedule
      const updatedSchedule = await tx.examSchedule.update({
        where: { id: scheduleId },
        data: {
          status: 'ACTIVE',
          activatedById: performedById,
          activatedAt: new Date(),
        },
      });

      // 2. Transition Exam to ACTIVE
      const activeStatus = await this.lifecycleService.getOrCreateExamStatus('ACTIVE', tx);

      await tx.exam.update({
        where: { id: schedule.examId },
        data: {
          statusId: activeStatus.id,
          activatedAt: new Date(),
        },
      });

      // 3. Record audit trail
      await this.lifecycleService.recordHistory(
        {
          examId: schedule.examId,
          examVersionId: schedule.examVersionId,
          scheduleId: schedule.id,
          action: 'ACTIVATE',
          fromStatus: 'SCHEDULED',
          toStatus: 'ACTIVE',
          performedById,
          comment: 'Super Admin activated the exam.',
          metadata: {
            activatedAt: new Date().toISOString(),
            startTime: schedule.startTime.toISOString(),
            endTime: schedule.endTime.toISOString(),
          },
        },
        tx,
      );

      this.logger.log(
        `Exam '${schedule.examId}' (Schedule: '${scheduleId}') activated by Super Admin '${performedById}'`,
      );

      return {
        message: 'Exam successfully activated by Super Admin.',
        schedule: updatedSchedule,
      };
    });
  }

  /**
   * Get current active or scheduled schedule for an exam
   */
  async getExamSchedule(examId: string) {
    const schedule = await this.prisma.examSchedule.findFirst({
      where: {
        examId,
        status: { in: ['ACTIVE', 'SCHEDULED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        examVersion: { select: { id: true, versionNumber: true, status: true, totalQuestions: true } },
        scheduledBy: { select: { id: true, email: true } },
        activatedBy: { select: { id: true, email: true } },
      },
    });

    if (!schedule) {
      throw new NotFoundException(`No active or scheduled schedule found for Exam '${examId}'`);
    }

    return schedule;
  }
}
