import { IsNotEmpty, IsString, Matches, IsOptional, IsEmail, IsUUID } from 'class-validator';

export class RegisterStudentDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be a valid E.164 phone number format (e.g. +919876543210 or 9876543210)',
  })
  phone: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsUUID()
  stateId?: string;

  @IsOptional()
  @IsUUID()
  districtId?: string;

  @IsNotEmpty()
  @IsString()
  schoolCollege: string;

  @IsNotEmpty()
  @IsUUID()
  classId: string;

  @IsNotEmpty()
  @IsUUID()
  preferredLanguageId: string;

  @IsNotEmpty()
  @IsUUID()
  examTargetId: string;
}
