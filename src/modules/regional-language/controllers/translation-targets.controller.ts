import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ExamTranslationService } from '../services/exam-translation.service';
import { ExamTranslationTargetsQueryDto } from '../dto/exam-translation.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TranslationTargetsController {
  constructor(
    private readonly examTranslationService: ExamTranslationService,
  ) {}

  /**
   * List all translation targets (Exams, Mock Tests, Subject-wise Mocks)
   * Sorted by createdAt DESC with full coverage summary, search, date range & filters
   * GET /translations/targets or GET /admin/translations/targets
   */
  @Get('translations/targets')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getTranslationTargets(
    @Query() query: ExamTranslationTargetsQueryDto,
    @CurrentUser() user: any,
  ) {
    const data = await this.examTranslationService.getTranslationTargets(
      query,
      user,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Translation targets retrieved successfully',
      data,
    };
  }

  @Get('admin/translations/targets')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAdminTranslationTargets(
    @Query() query: ExamTranslationTargetsQueryDto,
    @CurrentUser() user: any,
  ) {
    const data = await this.examTranslationService.getTranslationTargets(
      query,
      user,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Admin translation targets retrieved successfully',
      data,
    };
  }
}
