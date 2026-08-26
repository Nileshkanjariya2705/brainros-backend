import { IsNotEmpty, IsString, Matches, IsIn } from 'class-validator';
import type { OtpPurpose } from '../services/otp.service';

export class VerifyOtpLoginDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be a valid E.164 phone number format (e.g. +919876543210 or 9876543210)',
  })
  mobileNumber: string;

  @IsNotEmpty()
  @IsString()
  otp: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['LOGIN', 'REGISTER', 'CHANGE_MOBILE', 'RESET_PASSWORD', 'VERIFY_MOBILE', 'VERIFY_EMAIL'])
  purpose: OtpPurpose;
}
