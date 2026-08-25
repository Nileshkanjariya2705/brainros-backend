import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

// Controllers
import { InstitutionController } from './controllers/institution.controller';
import { InstitutionBatchController } from './controllers/institution-batch.controller';
import { BulkUploadController } from './controllers/bulk-upload.controller';
import { InstitutionDashboardController } from './controllers/institution-dashboard.controller';
import { ReportController } from './controllers/report.controller';

// Services
import { InstitutionAccessService } from './services/institution-access.service';
import { InstitutionService } from './services/institution.service';
import { InstitutionBatchService } from './services/institution-batch.service';
import { BulkUploadParserService } from './services/bulk-upload-parser.service';
import { BulkUploadValidatorService } from './services/bulk-upload-validator.service';
import { BulkUploadActivationService } from './services/bulk-upload-activation.service';
import { BulkUploadService } from './services/bulk-upload.service';
import { InstitutionDashboardService } from './services/institution-dashboard.service';
import { StorageService } from './services/storage.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { ReportService } from './services/report.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [
    InstitutionController,
    InstitutionBatchController,
    BulkUploadController,
    InstitutionDashboardController,
    ReportController,
  ],
  providers: [
    InstitutionAccessService,
    InstitutionService,
    InstitutionBatchService,
    BulkUploadParserService,
    BulkUploadValidatorService,
    BulkUploadActivationService,
    BulkUploadService,
    InstitutionDashboardService,
    StorageService,
    ReportGeneratorService,
    ReportService,
  ],
  exports: [
    InstitutionAccessService,
    InstitutionService,
    InstitutionBatchService,
    BulkUploadService,
    BulkUploadActivationService,
    InstitutionDashboardService,
    ReportService,
  ],
})
export class InstitutionModule {}
