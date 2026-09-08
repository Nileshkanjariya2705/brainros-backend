import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Request,
  Response,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { ConfigService } from '@nestjs/config';
import { OtpService } from './services/otp.service';
import { VerifyOtpDto, CheckUserDto } from './dto/verify-widget-otp.dto';
import { setAuthCookies } from './utils/cookie.util';

@Controller(['auth/otp', 'api/v1/auth/otp'])
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Verify MSG91 access token received from OTP widget and return JWT session.
   * Endpoints:
   *  POST /auth/otp/verify
   *  POST /api/v1/auth/otp/verify
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtpToken(
    @Body() dto: VerifyOtpDto,
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.otpService.verifyAccessToken(dto.token, req);

    setAuthCookies(res, this.configService, {
      accessToken: result.data?.accessToken,
      refreshToken: result.data?.refreshToken,
    });

    return result;
  }

  /**
   * User Existence Validation API required by MSG91 widget configuration if enabled.
   * Endpoints:
   *  GET /auth/otp/check-user
   *  GET /api/v1/auth/otp/check-user
   */
  @Get('check-user')
  @HttpCode(HttpStatus.OK)
  async checkUserExists(@Query() dto: CheckUserDto) {
    return this.otpService.checkUserExists(dto.identifier);
  }
}
