import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExamNotificationJobData,
  NOTIFICATION_QUEUE_NAME,
} from '../interfaces/exam-notification-job.interface';
import { NotificationChannel, NotificationPriority, NotificationStatus } from '@prisma/client';

@Processor(NOTIFICATION_QUEUE_NAME)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ExamNotificationJobData>): Promise<any> {
    const { type, examId, scheduleId } = job.data;
    this.logger.log(`Processing notification job [${job.id}] - Type: ${type}, Exam: ${examId}`);

    try {
      // 1. Fetch Exam with ExamTarget and Schedule
      const exam = await this.prisma.exam.findUnique({
        where: { id: examId },
        include: {
          examTarget: true,
          status: true,
          schedules: {
            where: scheduleId ? { id: scheduleId } : undefined,
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!exam) {
        this.logger.warn(`Exam with ID '${examId}' not found. Skipping notification job.`);
        return { status: 'SKIPPED_EXAM_NOT_FOUND' };
      }

      // 2. Format Dates
      const schedule = exam.schedules?.[0];
      const startTime = schedule?.startTime || exam.startTime || exam.examDate;
      const formattedDate = startTime
        ? new Date(startTime).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Kolkata',
          })
        : 'the upcoming scheduled slot';

      // 3. Build Notification Title & Message
      let title = job.data.title;
      let message = job.data.message;

      switch (type) {
        case 'EXAM_SCHEDULED':
          title = title || `New Exam Scheduled: ${exam.title}`;
          message =
            message ||
            `${exam.title} (${exam.examTarget.name}) has been scheduled for ${formattedDate}. View details & blueprint now.`;
          break;

        case 'EXAM_RESCHEDULED':
          title = title || `Exam Rescheduled: ${exam.title}`;
          message =
            message ||
            `The live examination window for ${exam.title} has been rescheduled to ${formattedDate}.`;
          break;

        case 'EXAM_CANCELLED':
          title = title || `Exam Cancelled: ${exam.title}`;
          message =
            message ||
            `The scheduled examination ${exam.title} has been cancelled by administration.`;
          break;

        case 'EXAM_STARTING_SOON':
        case 'EXAM_ACTIVATED':
          title = title || `Exam is Live: ${exam.title}`;
          message =
            message ||
            `${exam.title} is now active and open for submissions. Click to enter exam.`;
          break;

        case 'EXAM_RESULT_PUBLISHED':
        case 'RESULT_AVAILABLE':
          title = title || `Results Published: ${exam.title}`;
          message =
            message ||
            `Scorecards, subject rankings, and detailed diagnostic reports are now available for ${exam.title}.`;
          break;

        default:
          title = title || `Notification: ${exam.title}`;
          message = message || `Update regarding your examination ${exam.title}.`;
      }

      // Structured notification data payload
      const notificationData = {
        entityType: 'EXAM',
        entityId: exam.id,
        action: 'VIEW',
        examTitle: exam.title,
        examTarget: exam.examTarget.name,
        startTime: startTime ? new Date(startTime).toISOString() : null,
        durationMinutes: exam.durationMinutes,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
      };

      // 4. Find Eligible Students (All active students)
      const students = await this.prisma.student.findMany({
        where: {
          status: 'ACTIVE',
        },
        select: {
          id: true,
          userId: true,
          name: true,
        },
      });

      if (students.length === 0) {
        this.logger.log(`No active students found in system.`);
        return { status: 'COMPLETED_ZERO_STUDENTS' };
      }

      this.logger.log(
        `Found ${students.length} eligible student(s) for '${exam.title}'. Beginning batch insertion...`,
      );

      // 5. Chunk and Bulk Insert Notifications (500 students per batch)
      const BATCH_SIZE = 500;
      let totalCreated = 0;

      for (let i = 0; i < students.length; i += BATCH_SIZE) {
        const chunk = students.slice(i, i + BATCH_SIZE);

        const records = chunk.map((student) => ({
          userId: student.userId,
          recipientUserId: student.userId,
          channel: NotificationChannel.IN_APP,
          type,
          title,
          message,
          data: notificationData,
          payload: notificationData,
          priority: NotificationPriority.NORMAL,
          status: NotificationStatus.DELIVERED,
          isRead: false,
          idempotencyKey: `${type}_${exam.id}_${student.userId}`,
        }));

        const result = await this.prisma.notification.createMany({
          data: records,
          skipDuplicates: true,
        });

        totalCreated += result.count;
      }

      this.logger.log(
        `Successfully created ${totalCreated} in-app notification(s) for Exam '${exam.title}'`,
      );

      return {
        status: 'SUCCESS',
        examId: exam.id,
        eligibleStudents: students.length,
        notificationsCreated: totalCreated,
      };
    } catch (error: any) {
      this.logger.error(
        `Error processing exam notification job [${job.id}]: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
