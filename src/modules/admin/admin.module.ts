import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { ExamSchedulingModule } from '../exam-scheduling/exam-scheduling.module';
import { InstitutionModule } from '../institution/institution.module';
import { NotificationModule } from '../notification/notification.module';
import { ResultModule } from '../result/result.module';

// Controllers
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { SuperAdminDashboardController } from './controllers/super-admin-dashboard.controller';
import { AdminApprovalController } from './controllers/admin-approval.controller';
import { AdminExamControlController } from './controllers/admin-exam-control.controller';
import { AdminAuditLogController } from './controllers/admin-audit-log.controller';
import { AdminUserSearchController } from './controllers/admin-user-search.controller';
import { AdminStudentBulkController } from './controllers/admin-student-bulk.controller';
import { CompletedExamReportsController } from './controllers/completed-exam-reports.controller';
import { AdminStudentsController } from './controllers/admin-students.controller';

// Services & Processors
import { AdminDashboardService } from './dashboard/services/admin-dashboard.service';
import { SuperAdminDashboardService } from './dashboard/services/super-admin-dashboard.service';
import { AuditLogService } from './audit/services/audit-log.service';
import { ApprovalWorkflowService } from './approval/services/approval-workflow.service';
import { AdminHighRiskService } from './services/admin-high-risk.service';
import { StudentBulkRegistrationService } from './services/student-bulk-registration.service';
import { StudentBulkRegistrationProcessor } from './processors/student-bulk-registration.processor';
import { ResendEmailService } from './services/resend-email.service';
import { ExamReportPdfService } from './services/exam-report-pdf.service';
import { CompletedExamReportsService } from './services/completed-exam-reports.service';
import { ExamReportEmailProcessor } from './processors/exam-report-email.processor';
import { AdminStudentsService } from './services/admin-students.service';

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
    AuthModule,
    ExamSchedulingModule,
    InstitutionModule,
    NotificationModule,
    ResultModule,
    BullModule.registerQueue(
      {
        name: 'student-bulk-registration',
      },
      {
        name: 'exam-report-email',
      },
    ),
  ],
  controllers: [
    AdminDashboardController,
    SuperAdminDashboardController,
    AdminApprovalController,
    AdminExamControlController,
    AdminAuditLogController,
    AdminUserSearchController,
    AdminStudentBulkController,
    CompletedExamReportsController,
    AdminStudentsController,
  ],
  providers: [
    // Core Services
    AdminDashboardService,
    SuperAdminDashboardService,
    AuditLogService,
    ApprovalWorkflowService,
    AdminHighRiskService,
    StudentBulkRegistrationService,
    StudentBulkRegistrationProcessor,
    ResendEmailService,
    ExamReportPdfService,
    CompletedExamReportsService,
    ExamReportEmailProcessor,
    AdminStudentsService,

    // Approval Handlers & Registry
    ApprovalHandlerRegistry,
    QuestionApprovalHandler,
    ExamApprovalHandler,
    InstitutionApprovalHandler,
    BulkUploadApprovalHandler,
  ],
  exports: [
    AdminDashboardService,
    SuperAdminDashboardService,
    AuditLogService,
    ApprovalWorkflowService,
    AdminHighRiskService,
    ApprovalHandlerRegistry,
    StudentBulkRegistrationService,
    CompletedExamReportsService,
    ResendEmailService,
    ExamReportPdfService,
    AdminStudentsService,
  ],
})
export class AdminModule {}

