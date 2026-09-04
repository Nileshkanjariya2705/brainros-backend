import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginSendOtpDto {
  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  identifier?: string;
}

export class LoginVerifyOtpDto {
  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty({ message: 'OTP is required.' })
  @IsString()
  otp: string;

  @IsOptional()
  @IsString()
  loginRequestId?: string;
}
