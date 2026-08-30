import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExamCalendarService } from './exam-calendar.service';
import { ScheduleReminderService } from './schedule-reminder.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExamCalendarService (Academic Planning, UTC & Reminder Sync)', () => {
  let service: ExamCalendarService;
  let prisma: any;
  let reminderService: any;

  beforeEach(async () => {
    prisma = {
      examCycle: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cycle-1',
          name: '2026-27 Cycle',
          startDate: new Date('2026-04-01T00:00:00Z'),
          endDate: new Date('2027-03-31T23:59:59Z'),
        }),
      },
      exam: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'exam-1',
          title: 'NEET Mock 1',
        }),
      },
      examCalendar: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockImplementation((args) => ({ id: 'cal-1', ...args.data })),
        update: jest
          .fn()
          .mockImplementation((args) => ({ id: args.where.id, ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    reminderService = {
      scheduleExamReminders: jest.fn().mockResolvedValue(undefined),
      handleExamRescheduled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamCalendarService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleReminderService, useValue: reminderService },
      ],
    }).compile();

    service = module.get<ExamCalendarService>(ExamCalendarService);
  });

  describe('createCalendarEvent', () => {
    it('should create calendar event with UTC timestamps and arm reminders', async () => {
      const dto = {
        cycleId: 'cycle-1',
        examId: 'exam-1',
        plannedDate: '2026-09-10T00:00:00Z',
        plannedStartTime: '2026-09-10T04:30:00Z', // 10:00 AM IST
        plannedEndTime: '2026-09-10T07:50:00Z', // 1:20 PM IST
        timezone: 'Asia/Kolkata',
      };

      const res = await service.createCalendarEvent(dto);

      expect(res.id).toBe('cal-1');
      expect(prisma.examCalendar.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'Asia/Kolkata',
            scheduleVersion: 1,
          }),
        }),
      );
      expect(reminderService.scheduleExamReminders).toHaveBeenCalled();
    });

    it('should reject creation if planned start time is after end time', async () => {
      const dto = {
        cycleId: 'cycle-1',
        examId: 'exam-1',
        plannedDate: '2026-09-10T00:00:00Z',
        plannedStartTime: '2026-09-10T08:00:00Z',
        plannedEndTime: '2026-09-10T07:00:00Z',
      };

      await expect(service.createCalendarEvent(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject creation if planned date is outside cycle window', async () => {
      const dto = {
        cycleId: 'cycle-1',
        examId: 'exam-1',
        plannedDate: '2025-01-01T00:00:00Z', // Outside 2026-27 cycle
        plannedStartTime: '2025-01-01T04:30:00Z',
        plannedEndTime: '2025-01-01T07:50:00Z',
      };

      await expect(service.createCalendarEvent(dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rescheduleEvent (Version Increment & Invalidation)', () => {
    it('should increment scheduleVersion and notify reminder service to invalidate old reminders', async () => {
      prisma.examCalendar.findUnique.mockResolvedValue({
        id: 'cal-1',
        examId: 'exam-1',
        plannedStartTime: new Date('2026-09-10T04:30:00Z'),
        plannedEndTime: new Date('2026-09-10T07:50:00Z'),
        timezone: 'Asia/Kolkata',
        scheduleVersion: 1,
      });

      const res = await service.rescheduleEvent(
        'cal-1',
        {
          plannedDate: '2026-09-12T00:00:00Z',
          plannedStartTime: '2026-09-12T04:30:00Z',
          plannedEndTime: '2026-09-12T07:50:00Z',
          reason: 'Exam blueprint revision',
        },
        'admin-1',
      );

      expect(res.scheduleVersion).toBe(2);
      expect(reminderService.handleExamRescheduled).toHaveBeenCalledWith(
        expect.anything(),
        1, // oldVersion
      );
    });
  });
});
