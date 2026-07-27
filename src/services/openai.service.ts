import OpenAI from 'openai';
import { PersonalizationResult } from '../types';
import { PERSONALIZATION_PROMPT } from '../prompts/personalization.prompt';
import { config } from '../config/config';
import { TextCleaningService } from './text-cleaning.service';

export class OpenAIService {
  private static client: OpenAI | null = null;

  private static getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: config.openai.apiKey,
      });
    }
    return this.client;
  }

  static async generatePersonalization(
    mainPageText: string,
    aboutPageText: string,
    newsPageText: string
  ): Promise<PersonalizationResult> {
    try {
      const combinedText = TextCleaningService.combineTexts(
        mainPageText,
        aboutPageText,
        newsPageText
      );

      if (!combinedText || combinedText.trim().length === 0) {
        return {
          success: false,
          error: 'Нет текста для анализа',
        };
      }

      const prompt = PERSONALIZATION_PROMPT + combinedText;

      const client = this.getClient();

      const response = await client.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 200,
      });

      const personalization = response.choices[0]?.message?.content?.trim() || '';

      if (!personalization) {
        return {
          success: false,
          error: 'Пустой ответ от OpenAI',
        };
      }

      if (!TextCleaningService.validatePersonalizationLength(personalization)) {
        return {
          success: false,
          error: 'Персонализация превышает лимит слов',
        };
      }

      return {
        success: true,
        personalization,
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        return {
          success: false,
          error: `Ошибка OpenAI API: ${error.message}`,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка OpenAI',
      };
    }
  }
}
