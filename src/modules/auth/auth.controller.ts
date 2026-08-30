import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  Response,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginEmailDto } from './dto/login-email.dto';
import { LoginStudentIdDto } from './dto/login-student-id.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpLoginDto } from './dto/verify-otp.dto';
import { RegisterStudentDto } from './dto/register-student.dto';
import { VerifyRegistrationOtpDto } from './dto/verify-registration-otp.dto';
import {
  RequestPasswordlessLoginOtpDto,
  VerifyPasswordlessLoginOtpDto,
} from './dto/passwordless-login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import {
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  clearAuthCookies,
} from './utils/cookie.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 1. REGISTRATION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Submit registration data: creates pending registration state in Redis,
   * sends OTP to mobile number, and returns requiresOtp.
   * POST /auth/register
   */
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterStudentDto, @Request() req: any) {
    return this.authService.registerStudent(dto, req);
  }

  /**
   * Verify registration OTP: activates User, creates Student profile,
   * generates Student ID, creates session, and sets HttpOnly refresh cookie.
   * POST /auth/verify-registration-otp
   */
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post('verify-registration-otp')
  @HttpCode(HttpStatus.CREATED)
  async verifyRegistrationOtp(
    @Body() dto: VerifyRegistrationOtpDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.verifyRegistrationOtp(dto, req);
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });
    return result;
  }

  /**
   * Alias: POST /auth/register/verify-otp
   */
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post('register/verify-otp')
  @HttpCode(HttpStatus.CREATED)
  async verifyRegistrationOtpAlias(
    @Body() dto: VerifyRegistrationOtpDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    return this.verifyRegistrationOtp(dto, req, res);
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. UNIFIED PASSWORDLESS LOGIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Request passwordless login OTP: Accepts Email, Student ID, or Mobile number.
   * Sends OTP to the verified mobile number associated with the account.
   * POST /auth/login/request-otp
   */
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('login/request-otp')
  @HttpCode(HttpStatus.OK)
  async requestPasswordlessLoginOtp(
    @Body() dto: RequestPasswordlessLoginOtpDto,
    @Request() req: any,
  ) {
    return this.authService.requestPasswordlessLoginOtp(dto, req);
  }

  /**
   * Verify passwordless login OTP: Validates OTP, creates LoginSession,
   * sets HttpOnly refresh cookie, and returns access token + user details.
   * POST /auth/login/verify-otp
   */
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post('login/verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyPasswordlessLoginOtp(
    @Body() dto: VerifyPasswordlessLoginOtpDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.verifyPasswordlessLoginOtp(dto, req);
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. OTP RESEND ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Resend OTP (with cooldown and attempt protection)
   * POST /auth/otp/resend
   */
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto, @Request() req: any) {
    return this.authService.resendOtp(dto, req);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. GENERAL / BACKWARD-COMPATIBLE OTP ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto, @Request() req: any) {
    return this.authService.sendOtp(dto.phone, dto.purpose as any, req);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtpAndLogin(
    @Body() dto: VerifyOtpLoginDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.verifyOtpAndLogin(
      dto.mobileNumber,
      dto.otp,
      dto.purpose,
      req,
    );
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. LEGACY PASSWORD & OAUTH ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('login/email')
  @HttpCode(HttpStatus.OK)
  async loginWithEmail(
    @Body() dto: LoginEmailDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.loginWithEmail(
      dto.email,
      dto.password,
      req,
    );
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });
    return result;
  }

  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post('login/student-id')
  @HttpCode(HttpStatus.OK)
  async loginWithStudentId(
    @Body() dto: LoginStudentIdDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.loginWithStudentId(
      dto.studentId,
      dto.password,
      req,
    );
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });
    return result;
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async loginWithGoogle(
    @Body() dto: GoogleLoginDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.loginWithGoogle(dto.idToken, req);
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. TOKEN REFRESH & SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Rotate and refresh Access + Refresh Token pair using HttpOnly cookie or header.
   * POST /auth/refresh
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshSession(
    @Headers('x-refresh-token') headerToken: string,
    @Body('refreshToken') bodyToken: string,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const cookieToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.cookies?.refreshToken ||
      req.cookies?.refresh_token;
    const refreshToken = cookieToken || headerToken || bodyToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is missing.');
    }

    const result = await this.authService.refreshSession(refreshToken, req);
    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });

    return result;
  }

  /**
   * Revoke current session and clear HttpOnly cookies.
   * POST /auth/logout
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Headers('x-refresh-token') headerToken: string,
    @Body('refreshToken') bodyToken: string,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const cookieToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.cookies?.['refresh_token'] ||
      req.cookies?.['refreshToken'];
    const refreshToken = cookieToken || headerToken || bodyToken;

    if (refreshToken) {
      await this.authService.logout(refreshToken, req).catch(() => {});
    }

    clearAuthCookies(res, this.configService);

    return { message: 'Logged out successfully.' };
  }

  /**
   * Revoke all user sessions and clear HttpOnly cookies.
   * POST /auth/logout-all
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.logoutAll(req.user.userId, req);
    clearAuthCookies(res, this.configService);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@Request() req: any) {
    return this.authService.getSessions(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  async revokeSession(@Param('id') sessionId: string, @Request() req: any) {
    return this.authService.revokeSession(req.user.userId, sessionId, req);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Request() req: any) {
    const userProfile = await this.authService.getMe(req.user.userId);
    return {
      message: 'Profile retrieved successfully',
      data: userProfile,
    };
  }

  @Get('options')
  async getRegisterOptions() {
    const options = await this.authService.getRegisterOptions();
    return {
      message: 'Registration options retrieved successfully',
      data: options,
    };
  }
}
