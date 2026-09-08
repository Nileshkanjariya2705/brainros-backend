import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty({ message: 'Access token is required' })
  @IsString({ message: 'Access token must be a string' })
  token: string;
}

export class CheckUserDto {
  @IsNotEmpty({ message: 'User identifier (phone/email) is required' })
  @IsString({ message: 'User identifier must be a string' })
  identifier: string;
}
