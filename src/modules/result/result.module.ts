import { Module } from '@nestjs/common';
import { ResultController } from './result.controller';
import { ResultService } from './result.service';
import { AnalysisEngineService } from './services/analysis-engine.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ResultController],
  providers: [ResultService, AnalysisEngineService],
  exports: [ResultService, AnalysisEngineService],
})
export class ResultModule {}
