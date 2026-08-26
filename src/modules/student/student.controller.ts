import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StudentService } from './student.service';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import { RequestChangeMobileDto, VerifyChangeMobileDto } from './dto/change-mobile.dto';
import { RequestChangeEmailDto, VerifyChangeEmailDto } from './dto/change-email.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

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

  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('me/mobile/request-otp')
  @HttpCode(HttpStatus.OK)
  async requestChangeMobile(@Request() req: any, @Body() dto: RequestChangeMobileDto) {
    return this.studentService.requestChangeMobile(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Patch('me/mobile')
  @HttpCode(HttpStatus.OK)
  async patchMobileDirect(@Request() req: any, @Body() dto: RequestChangeMobileDto) {
    return this.studentService.requestChangeMobile(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post('me/mobile/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyChangeMobile(@Request() req: any, @Body() dto: VerifyChangeMobileDto) {
    return this.studentService.verifyChangeMobile(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('me/email/request-otp')
  @HttpCode(HttpStatus.OK)
  async requestChangeEmail(@Request() req: any, @Body() dto: RequestChangeEmailDto) {
    return this.studentService.requestChangeEmail(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Patch('me/email')
  @HttpCode(HttpStatus.OK)
  async patchEmailDirect(@Request() req: any, @Body() dto: RequestChangeEmailDto) {
    return this.studentService.requestChangeEmail(req.user.userId, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post('me/email/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyChangeEmail(@Request() req: any, @Body() dto: VerifyChangeEmailDto) {
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
