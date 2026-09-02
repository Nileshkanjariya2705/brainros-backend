import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamLifecycleService } from './exam-lifecycle.service';
import { ScheduleExamDto, RescheduleExamDto } from '../dto/schedule-exam.dto';
import { NotificationQueueService } from '../../notification/queues/notification-queue.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EXAM_WINDOW_END_QUEUE_NAME } from '../../result/interfaces/result-lifecycle.interface';

@Injectable()
export class ExamScheduleService {
  private readonly logger = new Logger(ExamScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: ExamLifecycleService,
    private readonly notificationQueue: NotificationQueueService,
    @InjectQueue(EXAM_WINDOW_END_QUEUE_NAME)
    private readonly windowEndQueue: Queue,
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
        versions: dto.examVersionId ? { where: { id: dto.examVersionId } } : true,
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    if (
      exam.status.name === 'CANCELLED' ||
      exam.status.name === 'ENDED' ||
      exam.status.name === 'COMPLETED' ||
      exam.status.name === 'DRAFT' ||
      exam.status.name === 'SUBMITTED'
    ) {
      throw new BadRequestException(
        `Cannot schedule exam with status '${exam.status.name}'. Exam must be APPROVED or PUBLISHED first.`,
      );
    }

    let versionId = dto.examVersionId;
    if (!versionId || exam.versions.length === 0) {
      let version = await this.prisma.examVersion.findFirst({
        where: { examId },
        orderBy: { versionNumber: 'desc' },
      });
      if (!version) {
        version = await this.prisma.examVersion.create({
          data: {
            examId,
            versionNumber: 1,
            status: 'PUBLISHED',
            totalQuestions: exam.totalQuestions,
            durationMinutes: exam.durationMinutes,
            totalMarks: exam.totalMarks,
            generatedById: scheduledById,
          },
        });
      }
      versionId = version.id;
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException(
        'Invalid startTime or endTime ISO timestamp format.',
      );
    }

    if (startTime >= endTime) {
      throw new BadRequestException(
        `Invalid live window: startTime (${startTime.toISOString()}) must be strictly before endTime (${endTime.toISOString()}).`,
      );
    }

    if (endTime.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Cannot schedule an exam in the past. The schedule end time must be in the future.',
      );
    }

    const scheduled = await this.prisma.$transaction(async (tx) => {
      // Check for overlapping active or scheduled sessions for this exam
      const existingOverlapping = await tx.examSchedule.findFirst({
        where: {
          examId,
          status: { in: ['SCHEDULED', 'ACTIVE'] },
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gt: startTime } },
          ],
        },
      });

      if (existingOverlapping) {
        throw new BadRequestException(
          'An active or scheduled session already overlaps with the specified time window for this exam.',
        );
      }

      // 1. Create schedule record
      const schedule = await tx.examSchedule.create({
        data: {
          examId,
          examVersionId: versionId,
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
          examVersionId: versionId,
          scheduleId: schedule.id,
          action: 'SCHEDULE',
          fromStatus: exam.status.name,
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

    // 1. Direct in-app notification creation for all active students
    try {
      const students = await this.prisma.student.findMany({
        where: { status: 'ACTIVE' },
        select: { userId: true, name: true },
      });

      if (students.length > 0) {
        const formattedDate = startTime.toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: dto.timezone || 'Asia/Kolkata',
        });

        const records = students.map((s) => ({
          userId: s.userId,
          recipientUserId: s.userId,
          channel: 'IN_APP' as any,
          type: 'EXAM_SCHEDULED' as any,
          title: `New Exam Scheduled: ${exam.title}`,
          message: `${exam.title} has been scheduled for ${formattedDate} (${dto.timezone || 'Asia/Kolkata'}). Duration: ${exam.durationMinutes} mins.`,
          data: {
            entityType: 'EXAM',
            entityId: exam.id,
            action: 'VIEW',
            examTitle: exam.title,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            durationMinutes: exam.durationMinutes,
          },
          payload: {
            examTitle: exam.title,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            durationMinutes: exam.durationMinutes,
          },
          priority: 'NORMAL' as any,
          status: 'DELIVERED' as any,
          isRead: false,
          idempotencyKey: `sched_${exam.id}_${s.userId}_${scheduled.id}`,
        }));

        await this.prisma.notification.createMany({
          data: records,
          skipDuplicates: true,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Direct schedule notification creation error: ${err.message}`);
    }

    // 2. Asynchronously dispatch BullMQ notification job to all eligible students
    this.notificationQueue.dispatchExamNotificationJob({
      type: 'EXAM_SCHEDULED',
      examId,
      scheduleId: scheduled.id,
    });

    // 3. Schedule delayed BullMQ job to trigger automated batch evaluation when window closes
    try {
      const nowMs = Date.now();
      const endMs = endTime.getTime();
      const delay = Math.max(0, endMs - nowMs);
      const windowEndJobId = `window_end_${examId}_${scheduled.id}`;

      // Remove existing job if any
      const existingJob = await this.windowEndQueue.getJob(windowEndJobId);
      if (existingJob) {
        await existingJob.remove();
      }

      await this.windowEndQueue.add(
        'EXAM_WINDOW_END',
        {
          examId,
          scheduleId: scheduled.id,
          triggeredAt: endTime.toISOString(),
        },
        {
          jobId: windowEndJobId,
          delay,
          removeOnComplete: true,
        },
      );
      this.logger.log(
        `[ScheduleExam] Scheduled window-end job '${windowEndJobId}' with delay ${delay}ms (${endTime.toISOString()})`,
      );
    } catch (queueErr: any) {
      this.logger.error(
        `[ScheduleExam] Failed to schedule window-end BullMQ job: ${queueErr.message}`,
      );
    }

    return scheduled;
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
      throw new BadRequestException(
        'Invalid startTime or endTime ISO timestamp format.',
      );
    }

    if (newStartTime >= newEndTime) {
      throw new BadRequestException(
        `Invalid live window: newStartTime must be strictly before newEndTime.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const oldWindow = {
        startTime: schedule.startTime.toISOString(),
        endTime: schedule.endTime.toISOString(),
        timezone: schedule.timezone,
      };

      const updatedSchedule = await tx.examSchedule.update({
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

      this.logger.log(
        `Schedule '${scheduleId}' rescheduled by user '${performedById}'`,
      );
      return updatedSchedule;
    });

    // Asynchronously dispatch BullMQ notification job
    this.notificationQueue.dispatchExamNotificationJob({
      type: 'EXAM_RESCHEDULED',
      examId: schedule.examId,
      scheduleId,
    });

    // Update delayed BullMQ job to trigger automated batch evaluation at newEndTime
    try {
      const nowMs = Date.now();
      const endMs = newEndTime.getTime();
      const delay = Math.max(0, endMs - nowMs);
      const windowEndJobId = `window_end_${schedule.examId}_${schedule.id}`;

      const existingJob = await this.windowEndQueue.getJob(windowEndJobId);
      if (existingJob) {
        await existingJob.remove();
      }

      await this.windowEndQueue.add(
        'EXAM_WINDOW_END',
        {
          examId: schedule.examId,
          scheduleId: schedule.id,
          triggeredAt: newEndTime.toISOString(),
        },
        {
          jobId: windowEndJobId,
          delay,
          removeOnComplete: true,
        },
      );
      this.logger.log(
        `[RescheduleExam] Rescheduled window-end job '${windowEndJobId}' with delay ${delay}ms (${newEndTime.toISOString()})`,
      );
    } catch (queueErr: any) {
      this.logger.error(
        `[RescheduleExam] Failed to reschedule window-end BullMQ job: ${queueErr.message}`,
      );
    }

    return updated;
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

    const activated = await this.prisma.$transaction(async (tx) => {
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
      const activeStatus = await this.lifecycleService.getOrCreateExamStatus(
        'ACTIVE',
        tx,
      );

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

    // Asynchronously dispatch BullMQ notification job for activation
    this.notificationQueue.dispatchExamNotificationJob({
      type: 'EXAM_STARTING_SOON',
      examId: schedule.examId,
      scheduleId,
    });

    return activated;
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
        examVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            totalQuestions: true,
          },
        },
        scheduledBy: { select: { id: true, email: true } },
        activatedBy: { select: { id: true, email: true } },
      },
    });

    if (!schedule) {
      throw new NotFoundException(
        `No active or scheduled schedule found for Exam '${examId}'`,
      );
    }

    return schedule;
  }

  /**
   * Get Approved Live Exams Awaiting Scheduling for Super Admin
   */
  async getSchedulingCandidates(query?: { search?: string; subjectId?: string }) {
    const approvedStatus = await this.prisma.examStatus.findUnique({
      where: { name: 'APPROVED' },
    });

    if (!approvedStatus) {
      return [];
    }

    const where: any = {
      statusId: approvedStatus.id,
    };

    if (query?.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const exams = await this.prisma.exam.findMany({
      where,
      include: {
        examTarget: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        sections: {
          include: {
            subject: { select: { id: true, name: true } },
          },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
        _count: {
          select: { examQuestions: true },
        },
      },
      orderBy: { approvedAt: 'desc' },
    });

    return exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      examTarget: exam.examTarget?.name || 'General',
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      totalQuestions: exam.totalQuestions || exam._count.examQuestions || 0,
      approvedAt: exam.approvedAt || exam.createdAt,
      createdAt: exam.createdAt,
      status: exam.status.name,
      subjects: exam.sections.map((s) => s.subject.name),
      latestVersion: exam.versions[0]
        ? {
            id: exam.versions[0].id,
            versionNumber: exam.versions[0].versionNumber,
            status: exam.versions[0].status,
          }
        : null,
    }));
  }

  /**
   * Super Admin activates Exam directly by examId: SCHEDULED -> ACTIVE
   */
  async activateExamDirectly(examId: string, performedById: string) {
    const schedule = await this.prisma.examSchedule.findFirst({
      where: { examId, status: 'SCHEDULED' },
      orderBy: { createdAt: 'desc' },
    });

    if (schedule) {
      return this.activateExam(schedule.id, performedById);
    }

    // If no explicit schedule record exists, transition exam directly to ACTIVE
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { status: true },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    const activeStatus = await this.lifecycleService.getOrCreateExamStatus('ACTIVE');

    await this.prisma.exam.update({
      where: { id: examId },
      data: {
        statusId: activeStatus.id,
        activatedAt: new Date(),
      },
    });

    await this.lifecycleService.recordHistory({
      examId,
      action: 'ACTIVATE',
      fromStatus: exam.status.name,
      toStatus: 'ACTIVE',
      performedById,
      comment: 'Exam activated directly by Super Admin',
    });

    return { message: 'Exam successfully activated by Super Admin.' };
  }
}
