import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamLifecycleService } from './exam-lifecycle.service';
import { ScheduleExamDto, RescheduleExamDto } from '../dto/schedule-exam.dto';
import { AdminScheduleExamDto, CheckQuestionAvailabilityDto } from '../dto/admin-schedule-exam.dto';
import { NotificationQueueService } from '../../notification/queues/notification-queue.service';
import { ScheduleReminderService } from './schedule-reminder.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EXAM_WINDOW_END_QUEUE_NAME } from '../../result/interfaces/result-lifecycle.interface';
import { EXAM_CACHE_PREPARATION_QUEUE_NAME } from '../../exam-cache/interfaces/exam-cache.interface';
import { ExamCacheService } from '../../exam-cache/services/exam-cache.service';

@Injectable()
export class ExamScheduleService {
  private readonly logger = new Logger(ExamScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: ExamLifecycleService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly scheduleReminderService: ScheduleReminderService,
    private readonly examCacheService: ExamCacheService,
    @InjectQueue(EXAM_WINDOW_END_QUEUE_NAME)
    private readonly windowEndQueue: Queue,
    @InjectQueue(EXAM_CACHE_PREPARATION_QUEUE_NAME)
    private readonly cachePrepQueue: Queue,
  ) {}

  /**
   * Check Question Pool Availability for configuration
   */
  async checkQuestionAvailability(dto: CheckQuestionAvailabilityDto) {
    const examTypeUpper = (dto.examType || '').toUpperCase();
    let availableCount = 0;
    const requiredCount = Number(dto.questionCount || 0);

    let resolvedTargetId = dto.examTargetId;
    if (dto.examTargetName) {
      const matched = await this.prisma.examTarget.findFirst({
        where: { name: { contains: dto.examTargetName, mode: 'insensitive' } },
      });
      if (matched) resolvedTargetId = matched.id;
    }

    if (examTypeUpper === 'SPECIFIC_CHAPTER') {
      if (dto.chapterId) {
        if (dto.subjectId) {
          const chapter = await this.prisma.chapter.findUnique({
            where: { id: dto.chapterId },
            select: { subjectId: true },
          });
          if (chapter && chapter.subjectId !== dto.subjectId) {
            throw new BadRequestException('Selected Chapter does not belong to the selected Subject.');
          }
        }
        availableCount = await this.prisma.question.count({
          where: {
            chapterId: dto.chapterId,
            status: 'APPROVED',
            isActive: true,
          },
        });
      }
    } else if (examTypeUpper === 'SPECIFIC_SUBJECT') {
      if (dto.subjectId) {
        if (resolvedTargetId) {
          const subject = await this.prisma.subject.findUnique({
            where: { id: dto.subjectId },
            select: { examTargetId: true },
          });
          if (subject && subject.examTargetId !== resolvedTargetId) {
            throw new BadRequestException('Selected Subject does not belong to the selected Exam Target.');
          }
        }
        availableCount = await this.prisma.question.count({
          where: {
            subjectId: dto.subjectId,
            status: 'APPROVED',
            isActive: true,
          },
        });
      }
    } else {
      // FULL_EXAM (JEE / NEET / CET)
      if (dto.blueprintId) {
        const bp = await this.prisma.examBlueprint.findUnique({
          where: { id: dto.blueprintId },
          include: { exam: true },
        });
        const targetId = bp?.exam?.examTargetId || resolvedTargetId;
        if (targetId) {
          availableCount = await this.prisma.question.count({
            where: {
              subject: { examTargetId: targetId },
              status: 'APPROVED',
              isActive: true,
            },
          });
        }
      } else if (resolvedTargetId) {
        availableCount = await this.prisma.question.count({
          where: {
            subject: { examTargetId: resolvedTargetId },
            status: 'APPROVED',
            isActive: true,
          },
        });
      }
    }

    const isAvailable = true;
    return {
      availableCount,
      requiredCount,
      isAvailable,
      message: availableCount > 0
        ? `${availableCount} question(s) available in bank (Question paper can also be uploaded after scheduling).`
        : 'Question paper can be uploaded after scheduling.',
    };
  }

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

      // 4. Record AuditLog for Super Admin Exam Time Control
      await tx.auditLog.create({
        data: {
          actorUserId: scheduledById,
          action: 'EXAM_SCHEDULE_CHANGE',
          entityType: 'EXAM_SCHEDULE',
          entityId: schedule.id,
          beforeState: { startTime: null, endTime: null },
          afterState: { startTime: startTime.toISOString(), endTime: endTime.toISOString() },
          metadata: {
            previousStartTime: null,
            newStartTime: startTime.toISOString(),
            previousEndTime: null,
            newEndTime: endTime.toISOString(),
            changedBy: scheduledById,
            changedAt: new Date().toISOString(),
          },
        },
      });

      // 5. Create pending ApprovalRequest for Super Admin approval queue
      const isMock =
        exam.title.toUpperCase().includes('MOCK') ||
        exam.title.toUpperCase().includes('PRACTICE');

      await tx.approvalRequest.create({
        data: {
          resourceType: isMock ? 'MOCK_TEST' : 'EXAM',
          resourceId: examId,
          requestedById: scheduledById,
          status: 'PENDING',
          metadata: {
            examId,
            title: exam.title,
            scheduleId: schedule.id,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalQuestions: exam.totalQuestions,
            durationMinutes: exam.durationMinutes,
            isMock,
          },
          submittedAt: new Date(),
        },
      });

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

    // 4. Schedule WhatsApp exam reminders (24H + 1H) for eligible students (non-blocking)
    const examForReminder = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { examTarget: true },
    }).catch(() => null);

    if (examForReminder?.examTargetId) {
      this.scheduleReminderService.scheduleExamWhatsAppReminders({
        examId,
        scheduleId: scheduled.id,
        examTargetId: examForReminder.examTargetId,
        examTitle: examForReminder.title,
        examTargetName: examForReminder.examTarget?.name || '',
        startTime,
        scheduleVersion: 1,
      }).catch((reminderErr: any) => {
        this.logger.warn(`[ScheduleExam] WhatsApp reminder scheduling error (non-blocking): ${reminderErr.message}`);
      });
    }

    return scheduled;
  }

  /**
   * Admin Exam Scheduling Flow: SPECIFIC_SUBJECT | SPECIFIC_CHAPTER | FULL_EXAM (JEE / NEET / CET)
   */
  async scheduleAdminExam(dto: AdminScheduleExamDto, scheduledById: string) {
    const startTime = new Date(dto.startTime);
    if (isNaN(startTime.getTime())) {
      throw new BadRequestException('Invalid startTime ISO timestamp format.');
    }

    let title = dto.examName?.trim() || dto.title?.trim();
    let durationMinutes = Number(dto.duration || dto.durationMinutes || 180);
    let totalQuestions = Number(dto.questionCount || dto.totalQuestions || 100);
    let examTargetId = dto.examTargetId;
    let subjectId = dto.subjectId;
    let chapterId = dto.chapterId;
    let blueprintId = dto.blueprintId;

    let targetName = dto.examTargetName || 'General';
    let subjectObj: any = null;
    let chapterObj: any = null;
    let blueprintObj: any = null;

    const examTypeUpper = (dto.examType || '').toUpperCase();

    // Resolve Target ID if target name was provided (e.g. JEE, NEET, CET)
    if (dto.examTargetName) {
      const matched = await this.prisma.examTarget.findFirst({
        where: { name: { contains: dto.examTargetName, mode: 'insensitive' } },
      });
      if (matched) {
        examTargetId = matched.id;
        targetName = matched.name;
      }
    }

    if (examTypeUpper === 'SPECIFIC_SUBJECT') {
      if (!subjectId) {
        throw new BadRequestException('Subject is required for Specific Subject exams.');
      }
      subjectObj = await this.prisma.subject.findUnique({
        where: { id: subjectId },
        include: { examTarget: true },
      });
      if (!subjectObj) {
        throw new NotFoundException(`Subject with ID '${subjectId}' not found.`);
      }

      // Validate Target -> Subject hierarchy
      if (examTargetId && subjectObj.examTargetId && subjectObj.examTargetId !== examTargetId) {
        throw new BadRequestException('Selected Subject does not belong to the selected Exam Target.');
      }

      examTargetId = subjectObj.examTargetId;
      targetName = subjectObj.examTarget?.name || targetName;
      if (!title) {
        title = `${subjectObj.name} Subject Exam`;
      }
      if (totalQuestions <= 0) {
        throw new BadRequestException('Question count must be greater than 0.');
      }
      if (durationMinutes <= 0) {
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
          `Only ${availableCount} valid questions are available. ${totalQuestions} are required.`,
        );
      }
    } else if (examTypeUpper === 'SPECIFIC_CHAPTER') {
      if (!subjectId || !chapterId) {
        throw new BadRequestException('Both Subject and Chapter are required for Specific Chapter exams.');
      }
      subjectObj = await this.prisma.subject.findUnique({
        where: { id: subjectId },
        include: { examTarget: true },
      });
      if (!subjectObj) {
        throw new NotFoundException(`Subject with ID '${subjectId}' not found.`);
      }

      // Validate Target -> Subject hierarchy
      if (examTargetId && subjectObj.examTargetId && subjectObj.examTargetId !== examTargetId) {
        throw new BadRequestException('Selected Subject does not belong to the selected Exam Target.');
      }

      chapterObj = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapterObj) {
        throw new NotFoundException(`Chapter with ID '${chapterId}' not found.`);
      }

      // Validate Subject -> Chapter hierarchy
      if (chapterObj.subjectId && chapterObj.subjectId !== subjectId) {
        throw new BadRequestException('Selected Chapter does not belong to the selected Subject.');
      }

      examTargetId = subjectObj.examTargetId;
      targetName = subjectObj.examTarget?.name || targetName;
      if (!title) {
        title = `${subjectObj.name} - ${chapterObj.name} Chapter Exam`;
      }
      if (totalQuestions <= 0) {
        throw new BadRequestException('Question count must be greater than 0.');
      }
      if (durationMinutes <= 0) {
        throw new BadRequestException('Duration in minutes must be greater than 0.');
      }
    } else {
      // FULL_EXAM — JEE / NEET / CET (or legacy types)
      const configMode = (dto.configurationMode || 'MANUAL').toUpperCase();

      if (configMode === 'BLUEPRINT' && blueprintId) {
        blueprintObj = await this.prisma.examBlueprint.findUnique({
          where: { id: blueprintId },
          include: {
            rules: true,
            exam: { include: { examTarget: true } },
          },
        });

        if (!blueprintObj) {
          throw new NotFoundException(`Blueprint with ID '${blueprintId}' not found.`);
        }

        totalQuestions = blueprintObj.totalQuestions || totalQuestions;
        durationMinutes = blueprintObj.exam?.durationMinutes || durationMinutes;
        examTargetId = blueprintObj.exam?.examTargetId || examTargetId;
        if (!title) {
          title = `${blueprintObj.name} (${targetName})`;
        }
      } else {
        // MANUAL mode (or fallback)
        if (!examTargetId) {
          const targetSearch = dto.examTargetName || (examTypeUpper === 'FULL_EXAM' ? 'NEET' : examTypeUpper);
          const matchedTarget = await this.prisma.examTarget.findFirst({
            where: {
              name: { contains: targetSearch === 'JEE_NEET_CET' ? 'NEET' : targetSearch, mode: 'insensitive' },
            },
          });
          if (matchedTarget) {
            examTargetId = matchedTarget.id;
            targetName = matchedTarget.name;
          }
        }
        if (!title) {
          title = `${targetName} Full Exam`;
        }
      }

      if (totalQuestions <= 0) {
        throw new BadRequestException('Question count must be greater than 0.');
      }
      if (durationMinutes <= 0) {
        throw new BadRequestException('Duration in minutes must be greater than 0.');
      }
    }

    // Dynamic End Time: strictly Start Time + Duration
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    if (startTime >= endTime) {
      throw new BadRequestException('End time must be greater than start time.');
    }

    if (endTime.getTime() <= Date.now()) {
      throw new BadRequestException('Cannot schedule an exam in the past. End time must be in the future.');
    }

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
      const marksPerQ = dto.marksPerQuestion !== undefined && dto.marksPerQuestion >= 0 ? Number(dto.marksPerQuestion) : 4;
      const negMarks = dto.negativeMarks !== undefined && dto.negativeMarks >= 0 ? Number(dto.negativeMarks) : 1;

      // 1. Create Exam record (Metadata and schedule window defined; questions attached on Question Paper upload)
      const exam = await tx.exam.create({
        data: {
          examTargetId,
          title,
          description: dto.description?.trim() || `Scheduled via Admin Exam Manager (${dto.examType})`,
          totalQuestions: Number(totalQuestions),
          totalMarks: Number(totalQuestions) * marksPerQ,
          durationMinutes,
          defaultMarksPerQuestion: marksPerQ,
          defaultNegativeMarks: negMarks,
          statusId: scheduledStatus.id,
          startTime,
          endTime,
          createdById: scheduledById,
        },
      });

      if (dto.languageId) {
        await tx.examLanguage.create({
          data: {
            examId: exam.id,
            languageId: dto.languageId,
            isDefault: true,
            displayOrder: 1,
          },
        }).catch(() => null);
      }

      // 2. Create Section
      if (subjectId) {
        await tx.examSection.create({
          data: {
            examId: exam.id,
            subjectId,
            name: subjectObj?.name || 'Section A',
            totalQuestions: Number(totalQuestions),
            displayOrder: 1,
          },
        });
      } else {
        const subjectsList = await tx.subject.findMany({
          where: { examTargetId },
          take: 4,
        });
        const sectionQuestions = Math.floor(Number(totalQuestions) / (subjectsList.length || 1));
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

      // 3. Create ExamVersion (Snapshot; question paper is prepared and uploaded separately)
      const version = await tx.examVersion.create({
        data: {
          examId: exam.id,
          blueprintId: blueprintId || undefined,
          versionNumber: 1,
          status: 'PUBLISHED',
          totalQuestions: Number(totalQuestions),
          durationMinutes,
          totalMarks: Number(totalQuestions) * marksPerQ,
          generatedById: scheduledById,
        },
      });


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

      // 6b. Create pending ApprovalRequest for Super Admin approval queue
      const isMockTest =
        title.toUpperCase().includes('MOCK') ||
        title.toUpperCase().includes('PRACTICE');

      await tx.approvalRequest.create({
        data: {
          resourceType: isMockTest ? 'MOCK_TEST' : 'EXAM',
          resourceId: exam.id,
          requestedById: scheduledById,
          status: 'PENDING',
          metadata: {
            examId: exam.id,
            title: exam.title,
            scheduleId: schedule.id,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalQuestions: Number(totalQuestions),
            durationMinutes,
            isMock: isMockTest,
          },
          submittedAt: new Date(),
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

      // 8. Record AuditLog for Super Admin Exam Time Control
      await tx.auditLog.create({
        data: {
          actorUserId: scheduledById,
          action: 'EXAM_SCHEDULE_CHANGE',
          entityType: 'EXAM_SCHEDULE',
          entityId: schedule.id,
          beforeState: { startTime: null, endTime: null },
          afterState: { startTime: startTime.toISOString(), endTime: endTime.toISOString() },
          metadata: {
            previousStartTime: null,
            newStartTime: startTime.toISOString(),
            previousEndTime: null,
            newEndTime: endTime.toISOString(),
            changedBy: scheduledById,
            changedAt: new Date().toISOString(),
          },
        },
      });

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

    // Asynchronously dispatch BullMQ exam question cache preparation job
    try {
      const cacheJobId = `cache_prep_${scheduleRecord.examId}_${scheduleRecord.examVersionId}`;
      await this.cachePrepQueue.add(
        'PREPARE_EXAM_CACHE',
        {
          examId: scheduleRecord.examId,
          examVersionId: scheduleRecord.examVersionId,
          scheduleId: scheduleRecord.id,
          officialExamEndTime: scheduleRecord.endTime.toISOString(),
          userId: scheduledById,
        },
        {
          jobId: cacheJobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      );
    } catch (cErr: any) {
      this.logger.warn(`Failed to enqueue cache preparation job: ${cErr.message}`);
    }

    // Schedule WhatsApp exam reminders (24H + 1H) for eligible students (non-blocking)
    if (scheduleRecord.exam?.examTarget?.id || scheduleRecord.exam?.examTargetId) {
      const targetId = (scheduleRecord.exam as any).examTargetId || scheduleRecord.exam?.examTarget?.id;
      const targetName = scheduleRecord.exam?.examTarget?.name || '';
      this.scheduleReminderService.scheduleExamWhatsAppReminders({
        examId: scheduleRecord.examId,
        scheduleId: scheduleRecord.id,
        examTargetId: targetId,
        examTitle: scheduleRecord.exam?.title || '',
        examTargetName: targetName,
        startTime: scheduleRecord.startTime,
        scheduleVersion: 1,
      }).catch((reminderErr: any) => {
        this.logger.warn(`[AdminScheduleExam] WhatsApp reminder scheduling error (non-blocking): ${reminderErr.message}`);
      });
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
    let newEndTime: Date;
    if (dto.endTime) {
      newEndTime = new Date(dto.endTime);
    } else {
      const durationMins = schedule.exam?.durationMinutes || 180;
      newEndTime = new Date(newStartTime.getTime() + durationMins * 60 * 1000);
    }

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

      // Record AuditLog for Super Admin Exam Reschedule
      await tx.auditLog.create({
        data: {
          actorUserId: performedById,
          action: 'EXAM_SCHEDULE_CHANGE',
          entityType: 'EXAM_SCHEDULE',
          entityId: schedule.id,
          beforeState: {
            startTime: schedule.startTime.toISOString(),
            endTime: schedule.endTime.toISOString(),
          },
          afterState: {
            startTime: newStartTime.toISOString(),
            endTime: newEndTime.toISOString(),
          },
          reason: dto.reason || 'Exam rescheduled by administrator.',
          metadata: {
            previousStartTime: schedule.startTime.toISOString(),
            newStartTime: newStartTime.toISOString(),
            previousEndTime: schedule.endTime.toISOString(),
            newEndTime: newEndTime.toISOString(),
            changedBy: performedById,
            changedAt: new Date().toISOString(),
          },
        },
      });

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

    // Update Redis question cache expiration based on new official end time
    await this.examCacheService
      .updateExamCacheTTL(schedule.examId, schedule.examVersionId, newEndTime)
      .catch((tErr: any) => {
        this.logger.warn(`Failed to update exam cache TTL on reschedule: ${tErr.message}`);
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

    // Cancel old WhatsApp reminders and schedule new ones for the updated time (non-blocking)
    const examForReminder = await this.prisma.exam.findUnique({
      where: { id: schedule.examId },
      include: { examTarget: true },
    }).catch(() => null);

    if (examForReminder?.examTargetId) {
      // Use updatedAt timestamp as an incrementing version signal
      const newVersion = Math.floor(Date.now() / 1000);
      this.scheduleReminderService.handleExamRescheduled(
        schedule.examId,
        scheduleId,
        examForReminder.examTargetId,
        examForReminder.title,
        examForReminder.examTarget?.name || '',
        newStartTime,
        newVersion - 1,   // cancel reminders from any older version
        newVersion,       // new version for fresh reminders
      ).catch((reminderErr: any) => {
        this.logger.warn(`[RescheduleExam] WhatsApp reminder reschedule error (non-blocking): ${reminderErr.message}`);
      });
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

    // Verify that question paper has been prepared and uploaded before activating
    if (this.prisma.examQuestion?.count) {
      const qCount = await this.prisma.examQuestion.count({
        where: { examId: schedule.examId },
      });
      if (qCount === 0) {
        throw new BadRequestException(
          'Cannot activate exam: No question paper has been uploaded or prepared for this exam yet. Please upload the question paper first.',
        );
      }
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

      // 4. Mark any pending approval request as APPROVED
      await tx.approvalRequest.updateMany({
        where: {
          resourceType: { in: ['EXAM', 'MOCK_TEST', 'MOCK'] },
          resourceId: schedule.examId,
          status: 'PENDING',
        },
        data: {
          status: 'APPROVED',
          reviewedById: performedById,
          reviewedAt: new Date(),
        },
      });

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

    // Verify that question paper has been prepared and uploaded before activating
    if (this.prisma.examQuestion?.count) {
      const qCount = await this.prisma.examQuestion.count({
        where: { examId },
      });
      if (qCount === 0) {
        throw new BadRequestException(
          'Cannot activate exam: No question paper has been uploaded or prepared for this exam yet. Please upload the question paper first.',
        );
      }
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
