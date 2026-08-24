import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ResultService } from './result.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('results')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResultController {
  constructor(private readonly resultService: ResultService) {}

  @Post(':attemptId/calculate')
  @Roles('ADMIN', 'SUPER_ADMIN', 'STUDENT')
  calculateResult(@Param('attemptId') attemptId: string) {
    return this.resultService.calculateResult(attemptId);
  }

  @Get(':attemptId')
  getResult(@Param('attemptId') attemptId: string) {
    return this.resultService.getResult(attemptId);
  }

  @Get(':attemptId/subjects')
  getSubjectResults(@Param('attemptId') attemptId: string) {
    return this.resultService.getSubjectResults(attemptId);
  }

  @Get(':attemptId/chapters')
  getChapterResults(@Param('attemptId') attemptId: string) {
    return this.resultService.getChapterResults(attemptId);
  }

  @Get(':attemptId/review')
  getAnswerReview(@Param('attemptId') attemptId: string) {
    return this.resultService.getAnswerReview(attemptId);
  }
}
