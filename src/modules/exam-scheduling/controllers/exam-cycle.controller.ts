import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ExamCycleService } from '../services/exam-cycle.service';
import { CreateExamCycleDto, UpdateExamCycleDto } from '../dto/calendar.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('exam-cycles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamCycleController {
  constructor(private readonly cycleService: ExamCycleService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT', 'PARENT', 'INSTITUTION_ADMIN')
  async getCycles() {
    return this.cycleService.getCycles();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT', 'PARENT', 'INSTITUTION_ADMIN')
  async getCycleById(@Param('id') id: string) {
    return this.cycleService.getCycleById(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createCycle(@CurrentUser() user: any, @Body() dto: CreateExamCycleDto) {
    return this.cycleService.createCycle(dto, user.userId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateCycle(@Param('id') id: string, @Body() dto: UpdateExamCycleDto) {
    return this.cycleService.updateCycle(id, dto);
  }
}
