import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExamAttemptService } from './exam-attempt.service';
import {
  StartAttemptDto,
  SaveAnswerDto,
  BulkSaveAnswersDto,
  SaveTimeLogDto,
} from './dto/attempt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('attempts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamAttemptController {
  constructor(
    private readonly attemptService: ExamAttemptService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Helper: Resolves the student ID from user token or provisions fallback student profile.
   */
  private async resolveStudentId(user: any): Promise<string> {
    if (user?.studentId) return user.studentId;

    const userId = user?.userId || user?.id || user?.sub;
    if (!userId) return '';

    const student = await this.prisma.student.findUnique({
      where: { userId },
    });
    if (student) return student.id;

    // Auto-create student profile if missing
    const defaultClass = await this.prisma.studentClass.findFirst();
    const defaultTarget = await this.prisma.examTarget.findFirst();
    const defaultLang = await this.prisma.preferredLanguage.findFirst();
    const count = await this.prisma.student.count();

    const newStudent = await this.prisma.student.create({
      data: {
        userId,
        studentId: `STU${String(count + 1000).padStart(6, '0')}`,
        studentCode: `BRN-2026-${String(count + 1).padStart(6, '0')}`,
        name: user.email?.split('@')[0] || 'Student',
        state: 'National',
        district: 'General',
        schoolCollege: 'Brainros Test Portal',
        classId: defaultClass?.id || '',
        examTargetId: defaultTarget?.id || '',
        preferredLanguageId: defaultLang?.id || '',
        status: 'ACTIVE',
      },
    });
    return newStudent.id;
  }

  @Post('start')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async startAttempt(
    @Body() dto: StartAttemptDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.startAttempt(dto, studentId, req.ip);
  }

  @Put(':id/answer')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async saveAnswer(
    @Param('id') attemptId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.saveAnswer(attemptId, dto, studentId);
  }

  @Put(':id/answers')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async bulkSaveAnswers(
    @Param('id') attemptId: string,
    @Body() dto: BulkSaveAnswersDto,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.bulkSaveAnswers(attemptId, dto, studentId);
  }

  @Post(':id/time-log')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async saveTimeLog(
    @Param('id') attemptId: string,
    @Body() dto: SaveTimeLogDto,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.saveTimeLog(attemptId, dto, studentId);
  }

  @Post(':id/submit')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async submitAttempt(
    @Param('id') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.submitAttempt(attemptId, studentId, 'USER_SUBMIT');
  }

  @Post(':id/leave')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async leaveAttempt(
    @Param('id') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.submitAttempt(attemptId, studentId, 'USER_LEAVE');
  }

  /**
   * Switch exam language during active attempt (zero answer loss / zero timer reset)
   * PATCH & PUT /attempts/:id/language
   */
  @Put(':id/language')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async switchAttemptLanguagePut(
    @Param('id') attemptId: string,
    @Body('languageId') languageId: string,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.switchAttemptLanguage(
      attemptId,
      languageId,
      studentId,
    );
  }

  @Patch(':id/language')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async switchAttemptLanguagePatch(
    @Param('id') attemptId: string,
    @Body('languageId') languageId: string,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.switchAttemptLanguage(
      attemptId,
      languageId,
      studentId,
    );
  }

  @Get(':id/status')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async getAttemptStatus(
    @Param('id') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.getAttemptStatus(attemptId, studentId);
  }

  @Get(':id/questions')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  async getAttemptQuestions(
    @Param('id') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.getAttemptQuestions(attemptId, studentId);
  }

  @Get('my-history')
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN', 'PARENT', 'INSTITUTION_ADMIN')
  async getMyAttempts(@CurrentUser() user: any) {
    const studentId = await this.resolveStudentId(user);
    return this.attemptService.getStudentAttempts(studentId, user?.userId);
  }
}
