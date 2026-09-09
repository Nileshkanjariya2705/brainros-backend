import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StudentTargetPredictionService } from '../services/student-target-prediction.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StudentTargetPredictionResult } from '../interfaces/predicted-rank.interface';

@Controller('predicted-rank')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentPredictedRankController {
  constructor(
    private readonly targetPredictionService: StudentTargetPredictionService,
  ) {}

  /**
   * Get predicted rank for current authenticated student based on their target exam
   */
  @Get('me')
  async getMyPredictedRank(
    @CurrentUser() user: any,
    @Query('targetExam') targetExam?: string,
  ): Promise<StudentTargetPredictionResult> {
    const userId = user.userId || user.id;
    return this.targetPredictionService.getStudentTargetPrediction(
      userId,
      targetExam,
    );
  }
}
