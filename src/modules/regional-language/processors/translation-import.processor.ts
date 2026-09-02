import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ExamTranslationService } from '../services/exam-translation.service';
import { RedisService } from '../../redis/redis.service';

export interface ExamTranslationImportJobData {
  examId: string;
  languageId: string;
  userId: string;
  fileName: string;
  fileBufferBase64: string;
  replaceMode: boolean;
  uploadedAt: string;
}

@Processor('translation-import')
@Injectable()
export class TranslationImportProcessor extends WorkerHost {
  private readonly logger = new Logger(TranslationImportProcessor.name);

  constructor(
    private readonly examTranslationService: ExamTranslationService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async process(job: Job<ExamTranslationImportJobData>): Promise<any> {
    const { examId, languageId, userId, fileName, fileBufferBase64, replaceMode } = job.data;
    const redisKey = `translation:status:${examId}:${languageId}`;

    this.logger.log(
      `[TranslationImportProcessor] Starting background import for Exam: ${examId}, Language: ${languageId}, File: ${fileName} (Job ID: ${job.id})`,
    );

    try {
      // Decode file buffer from base64
      const fileBuffer = Buffer.from(fileBufferBase64, 'base64');
      const file = {
        originalname: fileName,
        size: fileBuffer.length,
        buffer: fileBuffer,
      };

      // Execute transactional database persistence
      const result = await this.examTranslationService.importExamTranslations(
        examId,
        languageId,
        file,
        userId,
        replaceMode,
      );

      const importedQuestions = result.stats?.importedQuestions ?? 0;
      const importedOptions = result.stats?.importedOptions ?? 0;

      // Record successful completion in Redis (TTL: 24h)
      const completedState = {
        status: 'COMPLETED',
        fileName,
        completedAt: new Date().toISOString(),
        importedQuestions,
        importedOptions,
      };
      await this.redisService.set(redisKey, JSON.stringify(completedState), 86400);

      this.logger.log(
        `[TranslationImportProcessor] Successfully imported translations for Exam: ${examId}, Language: ${languageId}. Imported ${importedQuestions} questions and ${importedOptions} options.`,
      );

      return result;
    } catch (err: any) {
      this.logger.error(
        `[TranslationImportProcessor] Failed to import translations for Exam: ${examId}, Language: ${languageId}: ${err.message}`,
        err.stack,
      );

      // Record failure in Redis (TTL: 24h)
      const failedState = {
        status: 'FAILED',
        fileName,
        failedAt: new Date().toISOString(),
        error: err.message || 'Translation import processing failed.',
      };
      await this.redisService.set(redisKey, JSON.stringify(failedState), 86400);

      throw err;
    }
  }
}
