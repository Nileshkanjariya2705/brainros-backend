import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExamCalendarEventDto,
  RescheduleCalendarEventDto,
  CalendarFilterDto,
} from '../dto/calendar.dto';
import { ScheduleReminderService } from './schedule-reminder.service';

@Injectable()
export class ExamCalendarService {
  private readonly logger = new Logger(ExamCalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderService: ScheduleReminderService,
  ) {}

  /**
   * Create a planned exam calendar event with UTC persistence and conflict checks.
   */
  async createCalendarEvent(dto: CreateExamCalendarEventDto) {
    const cycle = await this.prisma.examCycle.findUnique({
      where: { id: dto.cycleId },
    });
    if (!cycle) {
      throw new NotFoundException(`Exam cycle '${dto.cycleId}' not found.`);
    }

    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
    });
    if (!exam) {
      throw new NotFoundException(`Exam '${dto.examId}' not found.`);
    }

    const start = new Date(dto.plannedStartTime);
    const end = new Date(dto.plannedEndTime);
    const plannedDate = new Date(dto.plannedDate);

    if (start >= end) {
      throw new BadRequestException(
        'Event plannedStartTime must be strictly before plannedEndTime.',
      );
    }

    if (plannedDate < cycle.startDate || plannedDate > cycle.endDate) {
      throw new BadRequestException(
        `Planned event date (${plannedDate.toISOString()}) must fall within cycle window [${cycle.startDate.toISOString()} - ${cycle.endDate.toISOString()}].`,
      );
    }

    // Overlap / conflict detection
    const overlapping = await this.prisma.examCalendar.findFirst({
      where: {
        cycleId: dto.cycleId,
        status: { in: ['PLANNED', 'CONFIRMED'] },
        OR: [
          {
            plannedStartTime: { lte: start },
            plannedEndTime: { gt: start },
          },
          {
            plannedStartTime: { lt: end },
            plannedEndTime: { gte: end },
          },
        ],
      },
      include: { exam: { select: { title: true } } },
    });

    if (overlapping) {
      this.logger.warn(
        `Calendar conflict detected with exam '${overlapping.exam.title}' during window ${start.toISOString()} - ${end.toISOString()}`,
      );
    }

    const event = await this.prisma.examCalendar.create({
      data: {
        cycleId: dto.cycleId,
        examId: dto.examId,
        plannedDate,
        plannedStartTime: start,
        plannedEndTime: end,
        timezone: dto.timezone || 'Asia/Kolkata',
        status: 'CONFIRMED',
        notes: dto.notes || null,
        scheduleVersion: 1,
      },
      include: {
        exam: { select: { id: true, title: true, durationMinutes: true } },
        cycle: { select: { id: true, name: true } },
      },
    });

    // Schedule automated reminders (24h, 1h, 15m)
    await this.reminderService.scheduleExamReminders(event);

    return event;
  }

  /**
   * Reschedule a planned calendar event, increment schedule version, and invalidate old reminders.
   */
  async rescheduleEvent(
    eventId: string,
    dto: RescheduleCalendarEventDto,
    actorUserId: string,
  ) {
    const existing = await this.prisma.examCalendar.findUnique({
      where: { id: eventId },
      include: { exam: true },
    });

    if (!existing) {
      throw new NotFoundException(`Calendar event '${eventId}' not found.`);
    }

    const newStart = new Date(dto.plannedStartTime);
    const newEnd = new Date(dto.plannedEndTime);
    const newPlannedDate = new Date(dto.plannedDate);

    if (newStart >= newEnd) {
      throw new BadRequestException(
        'plannedStartTime must be strictly before plannedEndTime.',
      );
    }

    const newVersion = existing.scheduleVersion + 1;

    const updated = await this.prisma.examCalendar.update({
      where: { id: eventId },
      data: {
        plannedDate: newPlannedDate,
        plannedStartTime: newStart,
        plannedEndTime: newEnd,
        timezone: dto.timezone || existing.timezone,
        status: 'RESCHEDULED',
        scheduleVersion: newVersion,
        notes: dto.reason,
      },
      include: { exam: true, cycle: true },
    });

    // Invalidate old reminder jobs and re-arm reminders for new schedule version
    await this.reminderService.handleExamRescheduled(
      updated,
      existing.scheduleVersion,
    );

    return updated;
  }

  /**
   * Get calendar events with filters
   */
  async getCalendarEvents(filter: CalendarFilterDto) {
    const page = filter.page || 1;
    const limit = filter.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.cycleId) where.cycleId = filter.cycleId;
    if (filter.examId) where.examId = filter.examId;
    if (filter.status) where.status = filter.status;

    if (filter.from || filter.to) {
      where.plannedDate = {};
      if (filter.from) where.plannedDate.gte = new Date(filter.from);
      if (filter.to) where.plannedDate.lte = new Date(filter.to);
    }

    const [events, total] = await Promise.all([
      this.prisma.examCalendar.findMany({
        where,
        skip,
        take: limit,
        orderBy: { plannedStartTime: 'asc' },
        include: {
          exam: {
            select: {
              id: true,
              title: true,
              durationMinutes: true,
              totalQuestions: true,
            },
          },
          cycle: { select: { id: true, name: true, academicYear: true } },
        },
      }),
      this.prisma.examCalendar.count({ where }),
    ]);

    return {
      data: events,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }
}
