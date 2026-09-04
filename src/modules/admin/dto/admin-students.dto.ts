import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
  IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum StudentSortField {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  STUDENT_ID = 'studentId',
  EMAIL = 'email',
  STATUS = 'status',
  SCHOOL_COLLEGE = 'schoolCollege',
}

export enum SortOrderEnum {
  ASC = 'asc',
  DESC = 'desc',
}

export enum ParentRelationshipEnum {
  FATHER = 'FATHER',
  MOTHER = 'MOTHER',
  GUARDIAN = 'GUARDIAN',
  OTHER = 'OTHER',
}

export class AdminStudentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(SortOrderEnum)
  sortOrder?: SortOrderEnum = SortOrderEnum.DESC;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  examTargetId?: string;

  @IsOptional()
  @IsUUID()
  stateId?: string;

  @IsOptional()
  @IsUUID()
  districtId?: string;

  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @IsOptional()
  @IsString()
  createdFrom?: string;

  @IsOptional()
  @IsString()
  createdTo?: string;
}

export class AddStudentParentDto {
  @IsString()
  @IsNotEmpty({ message: 'Parent name is required.' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Mobile number is required.' })
  mobile: string;

  @IsEmail({}, { message: 'A valid email address is required.' })
  @IsNotEmpty({ message: 'Email is required.' })
  email: string;

  @IsEnum(ParentRelationshipEnum, {
    message: 'Relationship must be FATHER, MOTHER, GUARDIAN, or OTHER.',
  })
  relationship: ParentRelationshipEnum;
}
