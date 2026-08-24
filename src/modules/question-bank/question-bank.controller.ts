import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { QuestionBankService } from './question-bank.service';
import { CreateQuestionDto, UpdateQuestionDto, QuestionFilterDto } from './dto/question.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionBankController {
  constructor(private readonly questionBankService: QuestionBankService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  createQuestion(@Body() dto: CreateQuestionDto, @CurrentUser() user: any) {
    return this.questionBankService.createQuestion(dto, user.userId);
  }

  @Get()
  findQuestions(@Query() filter: QuestionFilterDto) {
    return this.questionBankService.findQuestions(filter);
  }

  @Get('stats/:examTargetId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getQuestionStats(@Param('examTargetId') examTargetId: string) {
    return this.questionBankService.getQuestionStats(examTargetId);
  }

  @Get(':id')
  findQuestionById(@Param('id') id: string) {
    return this.questionBankService.findQuestionById(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateQuestion(@Param('id') id: string, @Body() dto: UpdateQuestionDto) {
    return this.questionBankService.updateQuestion(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  deleteQuestion(@Param('id') id: string) {
    return this.questionBankService.deleteQuestion(id);
  }
}
