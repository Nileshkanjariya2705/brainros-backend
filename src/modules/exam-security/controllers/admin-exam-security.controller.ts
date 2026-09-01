import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SecurityReviewService } from '../services/security-review.service';
import { ExamSecurityProfileService } from '../services/exam-security-profile.service';
import {
  ReviewSecurityAttemptDto,
  TerminateAttemptDto,
} from '../dto/security.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminExamSecurityController {
  constructor(
    private readonly securityReviewService: SecurityReviewService,
    private readonly securityProfileService: ExamSecurityProfileService,
  ) {}

  @Get('security-profiles')
  getAllProfiles() {
    return this.securityProfileService.getAllProfiles();
  }

  @Get('exams/:examId/security-summary')
  getExamSecuritySummary(@Param('examId') examId: string) {
    return this.securityReviewService.getExamSecuritySummary(examId);
  }

  @Get('attempts/:attemptId/security')
  getAttemptSecurityDetails(@Param('attemptId') attemptId: string) {
    return this.securityReviewService.getAttemptSecurityDetails(attemptId);
  }

  @Post('attempts/:attemptId/security-review')
  reviewAttempt(
    @Param('attemptId') attemptId: string,
    @Body() dto: ReviewSecurityAttemptDto,
    @CurrentUser() user: any,
  ) {
    const adminUserId = user.userId || user.id || user.sub;
    return this.securityReviewService.reviewAttempt(attemptId, dto, adminUserId);
  }

  @Post('attempts/:attemptId/terminate')
  terminateAttempt(
    @Param('attemptId') attemptId: string,
    @Body() dto: TerminateAttemptDto,
    @CurrentUser() user: any,
  ) {
    const adminUserId = user.userId || user.id || user.sub;
    return this.securityReviewService.terminateAttempt(
      attemptId,
      dto,
      adminUserId,
    );
  }
}
