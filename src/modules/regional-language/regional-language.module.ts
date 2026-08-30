import { Module } from '@nestjs/common';
import { LanguageService } from './services/language.service';
import { TranslationService } from './services/translation.service';
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
  providers: [LanguageService, TranslationService, ExamLanguageService],
  exports: [LanguageService, TranslationService, ExamLanguageService],
})
export class RegionalLanguageModule {}
