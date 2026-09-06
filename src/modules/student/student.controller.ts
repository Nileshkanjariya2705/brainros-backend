import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StudentService } from './student.service';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import {
  RequestChangeMobileDto,
  VerifyChangeMobileDto,
} from './dto/change-mobile.dto';
import {
  RequestChangeEmailDto,
  VerifyChangeEmailDto,
} from './dto/change-email.dto';
import {
  StudentExamsQueryDto,
  StudentMockTestsQueryDto,
} from './dto/student-exams.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  /**
   * GET /students/me/exams & /student/exams
   * Official scheduled and live exams listing for the logged-in student.
   */
  @Get(['me/exams', '/student/exams'])
  async getMyExams(@Request() req: any, @Query() query: StudentExamsQueryDto) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const result = await this.studentService.getStudentExams(userId, query);
    return {
      message: 'Student exams retrieved successfully',
      data: result.items,
      meta: result.pagination,
    };
  }

  /**
   * GET /students/me/mock-tests & /student/mock-tests
   * Practice tests & mock exams listing for the logged-in student.
   */
  @Get(['me/mock-tests', '/student/mock-tests'])
  async getMyMockTests(@Request() req: any, @Query() query: StudentMockTestsQueryDto) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const result = await this.studentService.getStudentMockTests(userId, query);
    return {
      message: 'Student mock tests retrieved successfully',
      data: result.items,
      meta: result.pagination,
    };
  }

  /**
   * GET /students/me/mock-history & /student/mock-history
   * Mock test attempt history with detailed analytics & subject breakdowns.
   */
  @Get(['me/mock-history', '/student/mock-history'])
  async getMyMockHistory(@Request() req: any, @Query() query: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const result = await this.studentService.getStudentMockHistory(userId, query);
    return {
      message: 'Student mock test history retrieved successfully',
      data: result,
    };
  }

  /**
   * GET /students/me/mock-tests/:mockTestId/attempts & /students/me/exams/:mockTestId/attempts
   * Returns all attempt records for a specific mock test for the logged-in student,
   * deterministically numbered and sorted newest first.
   */
  @Get(['me/mock-tests/:mockTestId/attempts', 'me/exams/:mockTestId/attempts'])
  async getMockTestAttempts(
    @Request() req: any,
    @Param('mockTestId') mockTestId: string,
    @Query() query: any,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const result = await this.studentService.getMockTestAttempts(
      userId,
      mockTestId,
      query,
    );
    return {
      message: 'Mock test attempts retrieved successfully',
      data: result.attempts,
      summary: result.summary,
      meta: result.pagination,
    };
  }

  @Get('me')
  async getMyProfile(@Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const data = await this.studentService.getProfile(userId);
    return {
      message: 'Student profile retrieved successfully',
      data,
    };
  }

  @Get('me/profile')
  async getMyProfileAlias(@Request() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const data = await this.studentService.getProfile(userId);
    return {
      message: 'Student profile retrieved successfully',
      data,
    };
  }

  @Patch('me')
  async updateMyProfile(
    @Request() req: any,
    @Body() dto: UpdateStudentProfileDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const data = await this.studentService.updateProfile(userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      message: 'Student profile updated successfully',
      data,
    };
  }

  @Patch('me/profile')
  async updateMyProfileAlias(
    @Request() req: any,
    @Body() dto: UpdateStudentProfileDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const data = await this.studentService.updateProfile(userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      message: 'Student profile updated successfully',
      data,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SENSITIVE CONTACT CHANGE ENDPOINTS (OTP VERIFIED)
  // ═══════════════════════════════════════════════════════════════

  @Post('me/mobile/request-otp')
  @HttpCode(HttpStatus.OK)
  async requestChangeMobile(
    @Request() req: any,
    @Body() dto: RequestChangeMobileDto,
  ) {
    return this.studentService.requestChangeMobile(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('me/mobile')
  @HttpCode(HttpStatus.OK)
  async patchMobileDirect(
    @Request() req: any,
    @Body() dto: RequestChangeMobileDto,
  ) {
    return this.studentService.requestChangeMobile(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('me/mobile/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyChangeMobile(
    @Request() req: any,
    @Body() dto: VerifyChangeMobileDto,
  ) {
    return this.studentService.verifyChangeMobile(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('me/email/request-otp')
  @HttpCode(HttpStatus.OK)
  async requestChangeEmail(
    @Request() req: any,
    @Body() dto: RequestChangeEmailDto,
  ) {
    return this.studentService.requestChangeEmail(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('me/email')
  @HttpCode(HttpStatus.OK)
  async patchEmailDirect(
    @Request() req: any,
    @Body() dto: RequestChangeEmailDto,
  ) {
    return this.studentService.requestChangeEmail(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('me/email/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyChangeEmail(
    @Request() req: any,
    @Body() dto: VerifyChangeEmailDto,
  ) {
    return this.studentService.verifyChangeEmail(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('me/sessions')
  async getMySessions(@Request() req: any) {
    const data = await this.studentService.getSessions(req.user.userId);
    return {
      message: 'Login sessions retrieved successfully',
      data,
    };
  }
}
