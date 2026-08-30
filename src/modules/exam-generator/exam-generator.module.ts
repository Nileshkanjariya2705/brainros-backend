import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExamRandomizationService } from './services/exam-randomization.service';

import { BlueprintValidationService } from './services/blueprint-validation.service';
import { QuestionPoolService } from './services/question-pool.service';
import { ExamSnapshotService } from './services/exam-snapshot.service';
import { BlueprintService } from './services/blueprint.service';
import { ExamGenerationService } from './services/exam-generation.service';
import { ExamGenerationProcessor } from './services/exam-generation.processor';
import { ExamBlueprintController } from './controllers/exam-blueprint.controller';
import { ExamGenerationController } from './controllers/exam-generation.controller';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'exam-generation',
    }),
  ],
  controllers: [ExamBlueprintController, ExamGenerationController],
  providers: [
    ExamRandomizationService,
    BlueprintValidationService,
    QuestionPoolService,
    ExamSnapshotService,
    BlueprintService,
    ExamGenerationService,
    ExamGenerationProcessor,
  ],
  exports: [
    ExamRandomizationService,
    BlueprintValidationService,
    QuestionPoolService,
    ExamSnapshotService,
    BlueprintService,
    ExamGenerationService,
    BullModule,
  ],
})
export class ExamGeneratorModule {}
