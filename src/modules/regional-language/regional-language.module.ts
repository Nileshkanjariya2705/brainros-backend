import { Module } from '@nestjs/common';
import { LanguageService } from './services/language.service';
import { TranslationService } from './services/translation.service';
import { TranslationImportService } from './services/translation-import.service';
import { ExamLanguageService } from './services/exam-language.service';
import { LanguageController } from './controllers/language.controller';
import { TranslationController } from './controllers/translation.controller';
import { ExamLanguageController } from './controllers/exam-language.controller';

@Module({
  controllers: [
    LanguageController,
    TranslationController,
    ExamLanguageController,
  ],
  providers: [
    LanguageService,
    TranslationService,
    TranslationImportService,
    ExamLanguageService,
  ],
  exports: [
    LanguageService,
    TranslationService,
    TranslationImportService,
    ExamLanguageService,
  ],
})
export class RegionalLanguageModule {}
