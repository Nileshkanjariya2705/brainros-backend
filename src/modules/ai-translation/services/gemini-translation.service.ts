import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface QuestionBatchItem {
  questionNumber: number;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
}

export interface TranslatedQuestionBatchItem {
  questionNumber: number;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
}

@Injectable()
export class GeminiTranslationService {
  private readonly logger = new Logger(GeminiTranslationService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private modelName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey =
      this.configService.get<string>('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY ||
      '';
    this.modelName =
      this.configService.get<string>('GEMINI_MODEL') ||
      process.env.GEMINI_MODEL ||
      'gemini-3.6-flash';

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not set. AI translation requests will fail until an API key is provided.',
      );
    }
  }

  /**
   * Translate a batch of questions to the target language
   */
  async translateBatch(
    questions: QuestionBatchItem[],
    targetLanguageName: string,
    targetLanguageCode: string,
  ): Promise<TranslatedQuestionBatchItem[]> {
    if (!this.genAI) {
      const apiKey =
        this.configService.get<string>('GEMINI_API_KEY') ||
        process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'GEMINI_API_KEY is missing. Please configure it in environment variables.',
        );
      }
      this.genAI = new GoogleGenerativeAI(apiKey);
    }

    const prompt = this.buildPrompt(questions, targetLanguageName, targetLanguageCode);
    const candidateModels = Array.from(
      new Set([this.modelName, 'gemini-3.6-flash', 'gemini-flash-latest']),
    );

    let lastError: Error | null = null;
    const maxAttempts = 3;

    for (const modelId of candidateModels) {
      const model = this.genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          const parsed = this.parseAndValidateResponse(responseText, questions);
          return parsed;
        } catch (err: any) {
          lastError = err;
          const isModelMissing =
            err?.message?.includes('404') || err?.message?.includes('not found');
          this.logger.warn(
            `Gemini translation attempt ${attempt}/${maxAttempts} with model '${modelId}' failed for language ${targetLanguageName}: ${err.message}`,
          );

          if (isModelMissing) {
            // Immediately switch to next candidate model
            break;
          }

          if (attempt < maxAttempts) {
            const delay = Math.pow(2, attempt) * 1500;
            await new Promise((res) => setTimeout(res, delay));
          }
        }
      }
    }

    throw new Error(
      `Gemini AI Translation failed after trying models [${candidateModels.join(', ')}]: ${lastError?.message || 'Unknown error'}`,
    );
  }

  private buildPrompt(
    questions: QuestionBatchItem[],
    targetLanguageName: string,
    targetLanguageCode: string,
  ): string {
    return `You are a certified professional academic translator specializing in educational and competitive examination question papers.
Translate the following exam questions and their multiple choice options from English into ${targetLanguageName} (${targetLanguageCode}).

STRICT RULES:
1. Translate the 'question', 'optionA', 'optionB', 'optionC', and 'optionD' text accurately with formal academic vocabulary.
2. DO NOT change or reorder 'questionNumber'.
3. Preserve all mathematical notation, formulas, chemical equations, numerical values, units, variable names, and proper nouns (names of people/places).
4. Output strictly a valid JSON array of objects with the exact schema:
[
  {
    "questionNumber": number,
    "question": "translated question text",
    "optionA": "translated option A",
    "optionB": "translated option B",
    "optionC": "translated option C",
    "optionD": "translated option D"
  }
]

INPUT QUESTIONS:
${JSON.stringify(questions, null, 2)}
`;
  }

  private parseAndValidateResponse(
    responseText: string,
    originalQuestions: QuestionBatchItem[],
  ): TranslatedQuestionBatchItem[] {
    let rawJson: any;
    try {
      // Clean possible markdown code fences if returned
      let cleanText = responseText.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.substring(7);
      }
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.substring(3);
      }
      if (cleanText.endsWith('```')) {
        cleanText = cleanText.substring(0, cleanText.length - 3);
      }
      cleanText = cleanText.trim();
      rawJson = JSON.parse(cleanText);
    } catch (e: any) {
      throw new Error(`Invalid JSON returned from Gemini model: ${e.message}`);
    }

    if (!Array.isArray(rawJson)) {
      throw new Error('Gemini response is not a JSON array.');
    }

    const resultMap = new Map<number, TranslatedQuestionBatchItem>();

    for (const item of rawJson) {
      if (
        typeof item.questionNumber !== 'number' ||
        !item.question ||
        !item.optionA ||
        !item.optionB ||
        !item.optionC ||
        !item.optionD
      ) {
        continue;
      }

      resultMap.set(item.questionNumber, {
        questionNumber: item.questionNumber,
        question: String(item.question).trim(),
        optionA: String(item.optionA).trim(),
        optionB: String(item.optionB).trim(),
        optionC: String(item.optionC).trim(),
        optionD: String(item.optionD).trim(),
      });
    }

    // Ensure all input questions have translations
    const translatedList: TranslatedQuestionBatchItem[] = [];
    for (const orig of originalQuestions) {
      const trans = resultMap.get(orig.questionNumber);
      if (!trans) {
        throw new Error(
          `Missing translated item for question #${orig.questionNumber} from AI model.`,
        );
      }
      translatedList.push(trans);
    }

    return translatedList;
  }
}
