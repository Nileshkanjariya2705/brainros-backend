import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { JobProgressModule } from '../job-progress/job-progress.module';
import { PdfExportService } from './services/pdf-export.service';
import { ExportRegistryService } from './services/export-registry.service';
import { ExportController } from './controllers/export.controller';
import { PdfExportProcessor, PDF_EXPORT_QUEUE_NAME } from './processors/pdf-export.processor';

@Module({
  imports: [
    PrismaModule,
    JobProgressModule,
    BullModule.registerQueue({
      name: PDF_EXPORT_QUEUE_NAME,
    }),
  ],
  controllers: [ExportController],
  providers: [PdfExportService, ExportRegistryService, PdfExportProcessor],
  exports: [PdfExportService, ExportRegistryService],
})
export class ExportModule {}
