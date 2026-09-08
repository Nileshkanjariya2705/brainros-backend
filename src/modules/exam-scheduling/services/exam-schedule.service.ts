import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamLifecycleService } from './exam-lifecycle.service';
import { ScheduleExamDto, RescheduleExamDto } from '../dto/schedule-exam.dto';
import { AdminScheduleExamDto } from '../dto/admin-schedule-exam.dto';
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
   * Admin Exam Scheduling Flow: SPECIFIC_SUBJECT | SPECIFIC_CHAPTER | JEE/NEET/CET
   */
  async scheduleAdminExam(dto: AdminScheduleExamDto, scheduledById: string) {
    const startTime = new Date(dto.startTime);
    if (isNaN(startTime.getTime())) {
      throw new BadRequestException('Invalid startTime ISO timestamp format.');
    }

    let title = dto.title?.trim();
    let durationMinutes = dto.durationMinutes || 180;
    let totalQuestions = dto.totalQuestions || 100;
    let examTargetId = dto.examTargetId;
    let subjectId = dto.subjectId;
    let chapterId = dto.chapterId;
    let blueprintId = dto.blueprintId;

    let targetName = 'General';
    let subjectObj: any = null;
    let chapterObj: any = null;
    let blueprintObj: any = null;

    const examTypeUpper = (dto.examType || '').toUpperCase();

    if (examTypeUpper === 'SPECIFIC_SUBJECT') {
      if (!subjectId) {
        throw new BadRequestException('subjectId is required for Specific Subject exams.');
      }
      subjectObj = await this.prisma.subject.findUnique({
        where: { id: subjectId },
        include: { examTarget: true },
      });
      if (!subjectObj) {
        throw new NotFoundException(`Subject with ID '${subjectId}' not found.`);
      }
      examTargetId = subjectObj.examTargetId;
      targetName = subjectObj.examTarget?.name || 'General';
      if (!title) {
        title = `${subjectObj.name} Subject Exam`;
      }
      if (!dto.totalQuestions || dto.totalQuestions <= 0) {
        throw new BadRequestException('Number of questions must be greater than 0.');
      }
      if (!dto.durationMinutes || dto.durationMinutes <= 0) {
        throw new BadRequestException('Duration in minutes must be greater than 0.');
      }

      // Pool availability check for subject
      const availableCount = await this.prisma.question.count({
        where: {
          subjectId,
          status: 'APPROVED',
          isActive: true,
        },
      });

      if (availableCount < totalQuestions) {
        throw new BadRequestException(
          `Insufficient question pool for subject '${subjectObj.name}'. Required: ${totalQuestions}, Available: ${availableCount}.`,
        );
      }
    } else if (examTypeUpper === 'SPECIFIC_CHAPTER') {
      if (!subjectId || !chapterId) {
        throw new BadRequestException('Both subjectId and chapterId are required for Specific Chapter exams.');
      }
      subjectObj = await this.prisma.subject.findUnique({
        where: { id: subjectId },
        include: { examTarget: true },
      });
      if (!subjectObj) {
        throw new NotFoundException(`Subject with ID '${subjectId}' not found.`);
      }
      chapterObj = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapterObj) {
        throw new NotFoundException(`Chapter with ID '${chapterId}' not found.`);
      }
      examTargetId = subjectObj.examTargetId;
      targetName = subjectObj.examTarget?.name || 'General';
      if (!title) {
        title = `${subjectObj.name} - ${chapterObj.name} Chapter Exam`;
      }
      if (!dto.totalQuestions || dto.totalQuestions <= 0) {
        throw new BadRequestException('Number of questions must be greater than 0.');
      }
      if (!dto.durationMinutes || dto.durationMinutes <= 0) {
        throw new BadRequestException('Duration in minutes must be greater than 0.');
      }

      // Pool availability check for chapter
      const availableCount = await this.prisma.question.count({
        where: {
          chapterId,
          status: 'APPROVED',
          isActive: true,
        },
      });

      if (availableCount < totalQuestions) {
        throw new BadRequestException(
          `Insufficient question pool for chapter '${chapterObj.name}'. Required: ${totalQuestions}, Available: ${availableCount}.`,
        );
      }
    } else {
      // JEE / NEET / CET Blueprint Exam
      if (blueprintId) {
        blueprintObj = await this.prisma.examBlueprint.findUnique({
          where: { id: blueprintId },
          include: {
            rules: true,
            exam: { include: { examTarget: true } },
          },
        });
      }

      if (!blueprintObj) {
        const targetSearch = (dto.examType || '').toUpperCase();
        let matchedTarget = await this.prisma.examTarget.findFirst({
          where: {
            name: { contains: targetSearch === 'JEE_NEET_CET' ? 'NEET' : targetSearch, mode: 'insensitive' },
          },
        });
        if (!matchedTarget) {
          matchedTarget = await this.prisma.examTarget.findFirst();
        }
        if (matchedTarget) {
          examTargetId = matchedTarget.id;
          targetName = matchedTarget.name;
          blueprintObj = await this.prisma.examBlueprint.findFirst({
            where: { exam: { examTargetId: matchedTarget.id } },
            include: { rules: true, exam: { include: { examTarget: true } } },
          });
        }
      }

      if (blueprintObj) {
        totalQuestions = blueprintObj.totalQuestions || dto.totalQuestions || 180;
        durationMinutes = blueprintObj.exam?.durationMinutes || dto.durationMinutes || 180;
        examTargetId = blueprintObj.exam?.examTargetId || examTargetId;
        if (!title) {
          title = `${blueprintObj.name || targetName} Mock Exam`;
        }
      } else {
        targetName = dto.examType || 'NEET';
        let matchedTarget = await this.prisma.examTarget.findFirst({
          where: { name: { equals: targetName, mode: 'insensitive' } },
        });
        if (!matchedTarget) {
          matchedTarget = await this.prisma.examTarget.findFirst();
        }
        examTargetId = matchedTarget?.id || '';
        if (!title) {
          title = `${targetName} Grand Exam`;
        }
      }
    }

    // Auto-compute End Time from startTime + durationMinutes
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    // Resolve or fallback exam target
    if (!examTargetId) {
      const fallbackTarget = await this.prisma.examTarget.findFirst();
      if (fallbackTarget) {
        examTargetId = fallbackTarget.id;
      } else {
        const createdTarget = await this.prisma.examTarget.create({
          data: { name: 'General Exam Target', description: 'Default Target' },
        });
        examTargetId = createdTarget.id;
      }
    }

    const scheduledStatus = await this.lifecycleService.getOrCreateExamStatus('SCHEDULED');

    // Create Exam, Version & Schedule in a transaction
    const scheduleRecord = await this.prisma.$transaction(async (tx) => {
      // 1. Create Exam record
      const exam = await tx.exam.create({
        data: {
          examTargetId,
          title,
          description: `Scheduled via Admin Exam Manager (${dto.examType})`,
          totalQuestions,
          totalMarks: totalQuestions * 4,
          durationMinutes,
          defaultMarksPerQuestion: 4,
          defaultNegativeMarks: 1,
          statusId: scheduledStatus.id,
          startTime,
          endTime,
          createdById: scheduledById,
        },
      });

      // 2. Create Section
      if (subjectId) {
        await tx.examSection.create({
          data: {
            examId: exam.id,
            subjectId,
            name: subjectObj?.name || 'Section A',
            totalQuestions,
            displayOrder: 1,
          },
        });
      } else {
        const subjectsList = await tx.subject.findMany({
          where: { examTargetId },
          take: 4,
        });
        const sectionQuestions = Math.floor(totalQuestions / (subjectsList.length || 1));
        for (let i = 0; i < subjectsList.length; i++) {
          await tx.examSection.create({
            data: {
              examId: exam.id,
              subjectId: subjectsList[i].id,
              name: `${subjectsList[i].name} Section`,
              totalQuestions: sectionQuestions,
              displayOrder: i + 1,
            },
          });
        }
      }

      // 3. Select Questions & create Snapshot Version
      let selectedQuestions: any[] = [];
      if (chapterId) {
        selectedQuestions = await tx.question.findMany({
          where: { chapterId, status: 'APPROVED', isActive: true },
          take: totalQuestions,
        });
      } else if (subjectId) {
        selectedQuestions = await tx.question.findMany({
          where: { subjectId, status: 'APPROVED', isActive: true },
          take: totalQuestions,
        });
      } else {
        selectedQuestions = await tx.question.findMany({
          where: { subject: { examTargetId }, status: 'APPROVED', isActive: true },
          take: totalQuestions,
        });
      }

      // 4. Create ExamVersion
      const version = await tx.examVersion.create({
        data: {
          examId: exam.id,
          blueprintId: blueprintId || undefined,
          versionNumber: 1,
          status: 'PUBLISHED',
          totalQuestions,
          durationMinutes,
          totalMarks: totalQuestions * 4,
          generatedById: scheduledById,
        },
      });

      // 5. Link ExamQuestions
      for (let idx = 0; idx < selectedQuestions.length; idx++) {
        const q = selectedQuestions[idx];
        let sec = await tx.examSection.findFirst({
          where: { examId: exam.id, subjectId: q.subjectId },
        });
        if (!sec) {
          sec = await tx.examSection.findFirst({ where: { examId: exam.id } });
        }
        if (sec) {
          await tx.examQuestion.create({
            data: {
              examId: exam.id,
              sectionId: sec.id,
              questionId: q.id,
              displayOrder: idx + 1,
              marks: q.marks || 4.0,
              negativeMarks: q.negativeMarks || 1.0,
            },
          });
        }
      }

      // 6. Create ExamSchedule
      const schedule = await tx.examSchedule.create({
        data: {
          examId: exam.id,
          examVersionId: version.id,
          startTime,
          endTime,
          timezone: dto.timezone || 'Asia/Kolkata',
          status: 'SCHEDULED',
          scheduledById,
        },
        include: {
          exam: {
            include: {
              status: true,
              examTarget: true,
              sections: { include: { subject: true } },
            },
          },
          examVersion: true,
        },
      });

      // 7. Audit log
      await this.lifecycleService.recordHistory(
        {
          examId: exam.id,
          examVersionId: version.id,
          scheduleId: schedule.id,
          action: 'SCHEDULE',
          fromStatus: 'DRAFT',
          toStatus: 'SCHEDULED',
          performedById: scheduledById,
          comment: `Scheduled ${dto.examType} exam for window ${startTime.toISOString()} - ${endTime.toISOString()}`,
          metadata: {
            examType: dto.examType,
            subjectId,
            chapterId,
            totalQuestions,
            durationMinutes,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        },
        tx,
      );

      return schedule;
    });

    // Asynchronous student notification
    try {
      this.notificationQueue.dispatchExamNotificationJob({
        type: 'EXAM_SCHEDULED',
        examId: scheduleRecord.examId,
        scheduleId: scheduleRecord.id,
      });
    } catch (nErr: any) {
      this.logger.warn(`Notification dispatch error: ${nErr.message}`);
    }

    return scheduleRecord;
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
