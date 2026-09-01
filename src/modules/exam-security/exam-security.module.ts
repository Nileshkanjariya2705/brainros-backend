import { Module, forwardRef } from '@nestjs/common';
import { ExamSecurityController } from './controllers/exam-security.controller';
import { AdminExamSecurityController } from './controllers/admin-exam-security.controller';
import { ExamSecurityProfileService } from './services/exam-security-profile.service';
import { ExamSessionService } from './services/exam-session.service';
import { SecurityEventService } from './services/security-event.service';
import { RiskEngineService } from './services/risk-engine.service';
import { SecurityReviewService } from './services/security-review.service';
import { ResultModule } from '../result/result.module';

@Module({
  imports: [forwardRef(() => ResultModule)],
  controllers: [ExamSecurityController, AdminExamSecurityController],
  providers: [
    ExamSecurityProfileService,
    ExamSessionService,
    SecurityEventService,
    RiskEngineService,
    SecurityReviewService,
  ],
  exports: [
    ExamSecurityProfileService,
    ExamSessionService,
    SecurityEventService,
    RiskEngineService,
    SecurityReviewService,
  ],
})
export class ExamSecurityModule {}
