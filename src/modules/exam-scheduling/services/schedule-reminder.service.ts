import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../notification/services/notification.service';
import { NotificationChannel, NotificationPriority, NotificationType } from '@prisma/client';

@Injectable()
export class ScheduleReminderService {
  private readonly logger = new Logger(ScheduleReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Schedule automated reminder windows (24h, 1h, 15m) tied to event scheduleVersion.
   */
  async scheduleExamReminders(calendarEvent: any) {
    const startTime = new Date(calendarEvent.plannedStartTime).getTime();
    const now = Date.now();

    const reminderWindows = [
      { name: '24 hours', offsetMs: 24 * 60 * 60 * 1000 },
      { name: '1 hour', offsetMs: 60 * 60 * 1000 },
      { name: '15 minutes', offsetMs: 15 * 60 * 1000 },
    ];

    for (const win of reminderWindows) {
      const scheduledTime = new Date(startTime - win.offsetMs);

      // Only schedule if the reminder time is in the future
      if (scheduledTime.getTime() > now) {
        await this.prisma.notification.create({
          data: {
            recipientAddress: 'ALL_ENROLLED_STUDENTS',
            channel: NotificationChannel.PUSH,
            type: NotificationType.EXAM_REMINDER,
            priority: NotificationPriority.HIGH,
            payload: {
              examId: calendarEvent.examId,
              examTitle: calendarEvent.exam?.title || 'Upcoming Exam',
              startsIn: win.name,
              plannedStartTime: calendarEvent.plannedStartTime,
            },
            status: 'PENDING',
            scheduledAt: scheduledTime,
            scheduleVersion: calendarEvent.scheduleVersion,
            idempotencyKey: `remind-${calendarEvent.id}-${win.name}-v${calendarEvent.scheduleVersion}`,
          },
        });
        this.logger.log(
          `Scheduled ${win.name} reminder for event '${calendarEvent.id}' at ${scheduledTime.toISOString()} (v${calendarEvent.scheduleVersion})`,
        );
      }
    }
  }

  /**
   * Invalidates outdated reminders when an exam is rescheduled and arms new reminder windows.
   */
  async handleExamRescheduled(calendarEvent: any, oldVersion: number) {
    this.logger.log(
      `Invalidating stale reminders for event '${calendarEvent.id}' with scheduleVersion <= ${oldVersion}`,
    );

    // Cancel pending notifications for old versions
    await this.prisma.notification.updateMany({
      where: {
        type: NotificationType.EXAM_REMINDER,
        scheduleVersion: { lte: oldVersion },
        status: 'PENDING',
        payload: {
          path: ['examId'],
          equals: calendarEvent.examId,
        },
      },
      data: {
        status: 'CANCELLED',
        lastError: `Cancelled due to exam rescheduling to ${calendarEvent.plannedStartTime}`,
      },
    });

    // Arm new reminders for new schedule version
    await this.scheduleExamReminders(calendarEvent);
  }
}
