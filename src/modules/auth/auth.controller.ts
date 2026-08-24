import { Controller, Get, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RegisterStudentDto } from './dto/register-student.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Send SMS OTP to mobile number
   * POST /auth/otp/send
   */
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.mobileNumber);
  }

  /**
   * Verify SMS OTP and login/register
   * POST /auth/otp/verify
   */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.mobileNumber, dto.otp);
  }

  /**
   * Register a new student (direct registration)
   * POST /auth/register/student
   */
  @Post('register/student')
  @HttpCode(HttpStatus.CREATED)
  async registerStudent(@Body() dto: RegisterStudentDto) {
    return this.authService.registerStudent(dto);
  }

  /**
   * Refresh JWT Session
   * POST /auth/refresh
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshSession(dto.refreshToken);
  }

  /**
   * Logout session (Revoke Refresh Token)
   * POST /auth/logout
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  /**
   * Get Current Authenticated User profile details
   * GET /auth/me
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: { userId: string }) {
    return this.authService.getMe(user.userId);
  }

  /**
   * Get registration options list (Classes, Languages, Exam Targets)
   * GET /auth/options
   */
  @Get('options')
  @HttpCode(HttpStatus.OK)
  async getRegisterOptions() {
    return this.authService.getRegisterOptions();
  }
}
