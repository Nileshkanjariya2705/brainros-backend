import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExamCalendarService } from '../services/exam-calendar.service';
import {
  CreateExamCalendarEventDto,
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

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT', 'PARENT', 'INSTITUTION_ADMIN')
  async getCalendarEvents(@Query() filter: CalendarFilterDto) {
    return this.calendarService.getCalendarEvents(filter);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createCalendarEvent(@Body() dto: CreateExamCalendarEventDto) {
    return this.calendarService.createCalendarEvent(dto);
  }

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
