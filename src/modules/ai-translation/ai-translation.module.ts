import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import {
  AI_TRANSLATION_QUEUE,
  AI_TRANSLATION_LANGUAGE_QUEUE,
} from './constants/ai-translation.constants';
import { AiTranslationController } from './controllers/ai-translation.controller';
import { AiTranslationService } from './services/ai-translation.service';
import { AiTranslationFileParserService } from './services/ai-translation-file-parser.service';
import { AiTranslationValidatorService } from './services/ai-translation-validator.service';
import { GeminiTranslationService } from './services/gemini-translation.service';
import { AiTranslationParentProcessor } from './processors/ai-translation-parent.processor';
import { AiTranslationLanguageProcessor } from './processors/ai-translation-language.processor';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    BullModule.registerQueue(
      {
        name: AI_TRANSLATION_QUEUE,
      },
      {
        name: AI_TRANSLATION_LANGUAGE_QUEUE,
      },
    ),
  ],
  controllers: [AiTranslationController],
  providers: [
    AiTranslationService,
    AiTranslationFileParserService,
    AiTranslationValidatorService,
    GeminiTranslationService,
    AiTranslationParentProcessor,
    AiTranslationLanguageProcessor,
  ],
  exports: [AiTranslationService],
})
export class AiTranslationModule {}
