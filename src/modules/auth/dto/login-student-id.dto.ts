import { IsNotEmpty, IsString } from 'class-validator';

export class LoginStudentIdDto {
  @IsNotEmpty()
  @IsString()
  studentId: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}
