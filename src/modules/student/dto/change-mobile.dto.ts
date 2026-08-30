import { IsNotEmpty, IsString, Matches, Length } from 'class-validator';

export class RequestChangeMobileDto {
  @IsNotEmpty({ message: 'New mobile number is required' })
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message:
      'Mobile number must be a valid E.164 phone number format (e.g. +919876543210 or 9876543210)',
  })
  newMobileNumber: string;
}

export class VerifyChangeMobileDto {
  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Length(4, 10, { message: 'OTP length is invalid' })
  otp: string;
}
