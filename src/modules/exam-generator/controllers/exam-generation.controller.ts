import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ExamGenerationService } from '../services/exam-generation.service';
import { GenerateExamDto } from '../dto/generate-exam.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamGenerationController {
  constructor(private readonly generationService: ExamGenerationService) {}

  @Post('blueprints/:blueprintId/generate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async generateExamVersion(
    @Param('blueprintId', ParseUUIDPipe) blueprintId: string,
    @Body() dto: GenerateExamDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.generationService.generateExamVersion(
      blueprintId,
      dto,
      userId,
    );
    return {
      statusCode: 201,
      message: 'Immutable ExamVersion generated successfully',
      data,
    };
  }

  @Get('exams/:examId/versions')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT')
  async getExamVersions(@Param('examId', ParseUUIDPipe) examId: string) {
    const data = await this.generationService.getExamVersions(examId);
    return {
      statusCode: 200,
      message: 'Exam versions fetched successfully',
      data,
    };
  }

  @Get('exam-versions/:versionId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT')
  async getExamVersionById(@Param('versionId', ParseUUIDPipe) versionId: string) {
    const data = await this.generationService.getExamVersionById(versionId);
    return {
      statusCode: 200,
      message: 'Exam version metadata fetched successfully',
      data,
    };
  }

  @Post('exam-versions/:versionId/publish')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async publishExamVersion(@Param('versionId', ParseUUIDPipe) versionId: string) {
    const data = await this.generationService.publishExamVersion(versionId);
    return {
      statusCode: 200,
      message: 'Exam version published successfully',
      data,
    };
  }

  @Get('exam-versions/:versionId/questions')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STUDENT')
  async getExamVersionQuestions(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query('languageId') languageId?: string,
  ) {
    const data = await this.generationService.getExamVersionQuestions(
      versionId,
      languageId,
    );
    return {
      statusCode: 200,
      message: 'Immutable exam questions fetched successfully',
      data,
    };
  }
}
