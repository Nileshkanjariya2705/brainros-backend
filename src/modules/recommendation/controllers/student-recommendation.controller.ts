import { Controller, Get, UseGuards, NotFoundException } from '@nestjs/common';
import { RecommendationEngineService } from '../services/recommendation-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('students/me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentRecommendationController {
  constructor(
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /students/me/recommendations
   * Get prioritized, personalized diagnostic recommendations for the authenticated student
   */
  @Get('recommendations')
  async getRecommendations(@CurrentUser() user: any) {
    const userId = user.userId || user.id || user.sub;
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException('Student profile not found.');
    }

    const recommendations =
      await this.recommendationEngine.generateStudentRecommendations(student.id);

    return {
      data: recommendations,
    };
  }
}
