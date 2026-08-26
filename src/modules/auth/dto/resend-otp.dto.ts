import { IsOptional, IsString } from 'class-validator';

export class ResendOtpDto {
  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsString()
  loginRequestId?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  purpose?: string;
}
