import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyRegistrationOtpDto {
  @IsNotEmpty({ message: 'Registration ID is required' })
  @IsString()
  registrationId: string;

  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Length(4, 10, { message: 'OTP length is invalid' })
  otp: string;
}
