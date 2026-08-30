import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message:
      'mobileNumber must be a valid E.164 phone number format (e.g. +919876543210)',
  })
  mobileNumber: string;
}
