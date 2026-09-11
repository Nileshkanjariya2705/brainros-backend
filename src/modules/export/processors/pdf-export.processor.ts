import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PdfExportService } from '../services/pdf-export.service';
import { ExportRegistryService, ExportRequestContext } from '../services/export-registry.service';
import { JobProgressService } from '../../job-progress/services/job-progress.service';
import * as fs from 'fs';
import * as path from 'path';

export const PDF_EXPORT_QUEUE_NAME = 'pdf-export';

export interface PdfExportJobData {
  exportId: string;
  context: ExportRequestContext;
}

@Processor(PDF_EXPORT_QUEUE_NAME, {
  concurrency: 2,
})
export class PdfExportProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfExportProcessor.name);
  private readonly tempDir = path.join(process.cwd(), 'temp', 'pdf-exports');

  constructor(
    private readonly pdfExportService: PdfExportService,
    private readonly exportRegistryService: ExportRegistryService,
    private readonly jobProgressService: JobProgressService,
  ) {
    super();
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async process(job: Job<PdfExportJobData>): Promise<{ exportId: string; filePath: string }> {
    const { exportId, context } = job.data;
    const jobId = String(job.id);

    this.logger.log(`Starting PDF Export Job ${jobId} for resource: ${context.resource}`);

    try {
      await this.jobProgressService.publishStarted(
        PDF_EXPORT_QUEUE_NAME,
        jobId,
        context.resource,
        'Initializing PDF generation...',
      );

      // Stage 1: Querying Data
      await this.jobProgressService.publishProgress(
        PDF_EXPORT_QUEUE_NAME,
        jobId,
        25,
        100,
        'Fetching & filtering records...',
      );

      const resolved = await this.exportRegistryService.resolveExport(context);

      // Stage 2: Building Document & Rendering Tables
      await this.jobProgressService.publishProgress(
        PDF_EXPORT_QUEUE_NAME,
        jobId,
        60,
        100,
        `Rendering ${resolved.options.data.length} records into branded PDF...`,
      );

      const buffer = await this.pdfExportService.generateTablePdf(resolved.options);

      // Stage 3: Saving File
      await this.jobProgressService.publishProgress(
        PDF_EXPORT_QUEUE_NAME,
        jobId,
        90,
        100,
        'Finalizing secure PDF document...',
      );

      const fileName = `${exportId}.pdf`;
      const filePath = path.join(this.tempDir, fileName);
      fs.writeFileSync(filePath, buffer);

      // Schedule cleanup after 1 hour
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.logger.log(`Cleaned up temporary export file: ${fileName}`);
          }
        } catch (e: any) {
          this.logger.warn(`Failed to cleanup export file ${fileName}: ${e.message}`);
        }
      }, 60 * 60 * 1000);

      await this.jobProgressService.publishCompleted(
        PDF_EXPORT_QUEUE_NAME,
        jobId,
        { exportId, fileName },
        'PDF generation completed successfully.',
      );

      return { exportId, filePath };
    } catch (err: any) {
      this.logger.error(`PDF Export Job ${jobId} failed: ${err.message}`, err.stack);
      await this.jobProgressService.publishFailed(
        PDF_EXPORT_QUEUE_NAME,
        jobId,
        err.message,
        'Unable to generate PDF document.',
      );
      throw err;
    }
  }
}
