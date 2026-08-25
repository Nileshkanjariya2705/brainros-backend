import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ExamSchedulingModule } from '../exam-scheduling/exam-scheduling.module';
import { InstitutionModule } from '../institution/institution.module';

// Controllers
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminApprovalController } from './controllers/admin-approval.controller';
import { AdminExamControlController } from './controllers/admin-exam-control.controller';
import { AdminAuditLogController } from './controllers/admin-audit-log.controller';
import { AdminUserSearchController } from './controllers/admin-user-search.controller';

// Services
import { AdminDashboardService } from './dashboard/services/admin-dashboard.service';
import { AuditLogService } from './audit/services/audit-log.service';
import { ApprovalWorkflowService } from './approval/services/approval-workflow.service';
import { AdminHighRiskService } from './services/admin-high-risk.service';

// Handlers & Registry
import { ApprovalHandlerRegistry } from './approval/handlers/approval-handler.registry';
import { QuestionApprovalHandler } from './approval/handlers/question-approval.handler';
import { ExamApprovalHandler } from './approval/handlers/exam-approval.handler';
import { InstitutionApprovalHandler } from './approval/handlers/institution-approval.handler';
import { BulkUploadApprovalHandler } from './approval/handlers/bulk-upload-approval.handler';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    ExamSchedulingModule,
    InstitutionModule,
  ],
  controllers: [
    AdminDashboardController,
    AdminApprovalController,
    AdminExamControlController,
    AdminAuditLogController,
    AdminUserSearchController,
  ],
  providers: [
    // Core Services
    AdminDashboardService,
    AuditLogService,
    ApprovalWorkflowService,
    AdminHighRiskService,

    // Approval Handlers & Registry
    ApprovalHandlerRegistry,
    QuestionApprovalHandler,
    ExamApprovalHandler,
    InstitutionApprovalHandler,
    BulkUploadApprovalHandler,
  ],
  exports: [
    AdminDashboardService,
    AuditLogService,
    ApprovalWorkflowService,
    AdminHighRiskService,
    ApprovalHandlerRegistry,
  ],
})
export class AdminModule {}
