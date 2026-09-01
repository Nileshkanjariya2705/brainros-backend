import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Res,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SubjectMockService } from '../services/subject-mock.service';
import {
  GenerateSubjectMockDto,
  SubjectTemplateQueryDto,
} from '../dto/subject-mock.dto';

@Controller('admin/exams/subject-wise')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubjectMockController {
  constructor(private readonly subjectMockService: SubjectMockService) {}

  /**
   * 1. Get Subject Mock Stats for Physics, Chemistry, Mathematics, Biology
   */
  @Get('stats')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getSubjectStats() {
    const data = await this.subjectMockService.getSubjectStats();
    return {
      statusCode: HttpStatus.OK,
      message: 'Subject mock stats retrieved successfully',
      data,
    };
  }

  /**
   * 2. Download Subject Mock Template (XLSX / CSV) with sample questions for selected subject
   */
  @Get('template')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async downloadTemplate(
    @Query() query: SubjectTemplateQueryDto,
    @Res() res: Response,
  ) {
    if (!query.subject) {
      throw new BadRequestException('Query parameter "subject" is required.');
    }
    const { buffer, fileName, contentType } =
      await this.subjectMockService.generateTemplate(
        query.subject,
        query.format || 'xlsx',
      );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }

  /**
   * 3. Upload & Validate Subject Mock Questions File (CSV / XLSX / XLS)
   */
  @Post('upload')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    }),
  )
  async uploadSubjectMockFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('subject') subject: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!subject) {
      throw new BadRequestException('Form field "subject" is required.');
    }
    if (!file) {
      throw new BadRequestException('File is required for upload.');
    }

    const data = await this.subjectMockService.uploadAndValidate(
      file,
      subject,
      userId,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'File uploaded and validated successfully',
      data,
    };
  }

  /**
   * 4. Transactionally Generate Subject-wise Mock Exam from Validated Upload
   */
  @Post('generate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async generateSubjectMock(
    @Body() dto: GenerateSubjectMockDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.subjectMockService.generateSubjectMockExam(
      dto,
      userId,
    );

    return {
      statusCode: HttpStatus.CREATED,
      message: `${dto.subject} Mock Test generated successfully`,
      data,
    };
  }
}
