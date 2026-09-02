import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '../redis/redis.module';
import { LanguageService } from './services/language.service';
import { TranslationService } from './services/translation.service';
import { TranslationImportService } from './services/translation-import.service';
import { ExamLanguageService } from './services/exam-language.service';
import { ExamTranslationService } from './services/exam-translation.service';
import { LanguageController } from './controllers/language.controller';
import { TranslationController } from './controllers/translation.controller';
import { ExamLanguageController } from './controllers/exam-language.controller';
import { ExamTranslationController } from './controllers/exam-translation.controller';
import { TranslationTargetsController } from './controllers/translation-targets.controller';
import { TranslationImportProcessor } from './processors/translation-import.processor';

@Module({
  imports: [
    RedisModule,
    BullModule.registerQueue({
      name: 'translation-import',
    }),
  ],
  controllers: [
    LanguageController,
    TranslationController,
    ExamLanguageController,
    ExamTranslationController,
    TranslationTargetsController,
  ],
  providers: [
    LanguageService,
    TranslationService,
    TranslationImportService,
    ExamLanguageService,
    ExamTranslationService,
    TranslationImportProcessor,
  ],
  exports: [
    LanguageService,
    TranslationService,
    TranslationImportService,
    ExamLanguageService,
    ExamTranslationService,
  ],
})
export class RegionalLanguageModule {}
