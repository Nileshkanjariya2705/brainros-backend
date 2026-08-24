import { IsNotEmpty, IsString, Matches, IsEmail, IsOptional, IsUUID } from 'class-validator';

export class RegisterStudentDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be a valid E.164 phone number format',
  })
  phone: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format' })
  email?: string;

  @IsNotEmpty()
  @IsString()
  state: string;

  @IsNotEmpty()
  @IsString()
  district: string;

  @IsNotEmpty()
  @IsString()
  schoolCollege: string;

  @IsNotEmpty()
  @IsUUID('4', { message: 'classId must be a valid UUID' })
  classId: string;

  @IsNotEmpty()
  @IsUUID('4', { message: 'preferredLanguageId must be a valid UUID' })
  preferredLanguageId: string;

  @IsNotEmpty()
  @IsUUID('4', { message: 'examTargetId must be a valid UUID' })
  examTargetId: string;
}
