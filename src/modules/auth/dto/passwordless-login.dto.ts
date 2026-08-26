import { IsNotEmpty, IsString, Length } from 'class-validator';

export class RequestPasswordlessLoginOtpDto {
  @IsNotEmpty({ message: 'Identifier (Email, Student ID, or Mobile number) is required' })
  @IsString()
  identifier: string;
}

export class VerifyPasswordlessLoginOtpDto {
  @IsNotEmpty({ message: 'Login Request ID is required' })
  @IsString()
  loginRequestId: string;

  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Length(4, 10, { message: 'OTP length is invalid' })
  otp: string;
}
