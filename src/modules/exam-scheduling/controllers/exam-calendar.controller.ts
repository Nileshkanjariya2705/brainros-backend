import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ExamCalendarService } from '../services/exam-calendar.service';
import {
  CreateExamCalendarEventDto,
  UpdateCalendarEventDto,
  RescheduleCalendarEventDto,
  CalendarFilterDto,
} from '../dto/calendar.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('exam-calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamCalendarController {
  constructor(private readonly calendarService: ExamCalendarService) {}

  /**
   * GET /exam-calendar/years
   * Returns distinct years from calendar entries (for the year dropdown).
   */
  @Get('years')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getAvailableYears() {
    return this.calendarService.getAvailableYears();
  }

  /**
   * GET /exam-calendar
   * List calendar events with optional filters (year, status, search, etc.)
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT', 'PARENT', 'INSTITUTION_ADMIN')
  async getCalendarEvents(@Query() filter: CalendarFilterDto) {
    return this.calendarService.getCalendarEvents(filter);
  }

  /**
   * POST /exam-calendar
   * Create a new academic calendar entry.
   */
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createCalendarEvent(
    @CurrentUser() user: any,
    @Body() dto: CreateExamCalendarEventDto,
  ) {
    return this.calendarService.createCalendarEvent(dto, user?.userId);
  }

  /**
   * PUT /exam-calendar/:id
   * Update an existing calendar entry (exam, date, time, duration).
   * End time is recalculated server-side from durationMinutes.
   */
  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateCalendarEvent(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.updateCalendarEvent(id, dto, user?.userId);
  }

  /**
   * DELETE /exam-calendar/:id
   * Delete only the calendar entry — does NOT delete the Exam record.
   */
  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async deleteCalendarEvent(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.calendarService.deleteCalendarEvent(id, user?.userId);
  }

  /**
   * PATCH /exam-calendar/:id/reschedule (legacy endpoint — kept for backward compat)
   */
  @Patch(':id/reschedule')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async rescheduleEvent(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RescheduleCalendarEventDto,
  ) {
    return this.calendarService.rescheduleEvent(id, dto, user.userId);
  }
}
