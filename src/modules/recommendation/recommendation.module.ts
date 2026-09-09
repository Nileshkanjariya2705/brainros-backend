import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecommendationEngineService } from './services/recommendation-engine.service';
import { StudentRecommendationController } from './controllers/student-recommendation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StudentRecommendationController],
  providers: [RecommendationEngineService],
  exports: [RecommendationEngineService],
})
export class RecommendationModule {}
