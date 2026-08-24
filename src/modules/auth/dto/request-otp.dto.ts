import { IsNotEmpty, IsString, Matches, IsIn } from 'class-validator';

export class RequestOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be a valid E.164 phone number format (e.g. +919876543210 or 9876543210)',
  })
  phone: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['LOGIN', 'REGISTRATION', 'CHANGE_PHONE'])
  purpose: 'LOGIN' | 'REGISTRATION' | 'CHANGE_PHONE';
}
