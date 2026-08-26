import { IsNotEmpty, IsEmail, IsString, Length } from 'class-validator';

export class RequestChangeEmailDto {
  @IsNotEmpty({ message: 'New email address is required' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  newEmail: string;
}

export class VerifyChangeEmailDto {
  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Length(4, 10, { message: 'OTP length is invalid' })
  otp: string;
}
