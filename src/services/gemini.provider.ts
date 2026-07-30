import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, PersonalizationResult } from '../types/index.js';
import { TextCleaningService } from './text-cleaning.service.js';
import { Logger } from '../utils/logger.js';
import { config } from '../config/config.js';

const FALLBACK_PERSONALIZATION = 'Не удалось найти достоверный факт для персонализации.';

export class GeminiProvider implements LLMProvider {
  private static client: GoogleGenerativeAI | null = null;
  private static lastCallAt = 0;
  private static requestCount = 0;
  private static hardQuotaBlocked = false;
  private static hardQuotaMessage = '';

  private static getClient(): GoogleGenerativeAI {
    if (!this.client) {
      this.client = new GoogleGenerativeAI(config.llm.apiKey);
    }
    return this.client;
  }

  static resetClient(): void {
    GeminiProvider.client = null;
    GeminiProvider.hardQuotaBlocked = false;
    GeminiProvider.hardQuotaMessage = '';
    GeminiProvider.requestCount = 0;
  }

  private static async waitForRateGap(): Promise<void> {
    const minGapMs = 3000;
    const elapsed = Date.now() - GeminiProvider.lastCallAt;
    if (elapsed < minGapMs) {
      await new Promise(resolve => setTimeout(resolve, minGapMs - elapsed));
    }
    GeminiProvider.lastCallAt = Date.now();
  }

  private static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private static isZeroQuotaError(message: string): boolean {
    return /limit:\s*0\b/i.test(message);
  }

  private static isDailyQuotaError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('generaterequestsperday') ||
      lower.includes('perdayperproject') ||
      lower.includes('per_day')
    );
  }

  private static isRateLimitError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('429') ||
      lower.includes('too many requests') ||
      lower.includes('quota exceeded') ||
      lower.includes('rate limit')
    );
  }

  private static isModelNotFoundError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('404') ||
      lower.includes('no longer available') ||
      lower.includes('not found')
    );
  }

  private static extractRetryDelayMs(message: string): number {
    const retryIn = message.match(/retry in ([\d.]+)s/i);
    if (retryIn?.[1]) {
      return Math.ceil(parseFloat(retryIn[1]) * 1000) + 500;
    }
    return 20000;
  }

  private static buildQuotaMessage(message: string, modelName: string): string {
    if (GeminiProvider.isZeroQuotaError(message)) {
      return (
        `Ошибка: у API-ключа нет бесплатной квоты на модель ${modelName} (limit: 0). ` +
        `Включи billing в AI Studio или смени ключ/модель.`
      );
    }

    if (GeminiProvider.isDailyQuotaError(message)) {
      return (
        `Ошибка: дневной лимит Gemini для ${modelName} исчерпан. ` +
        `Подожди сброса квоты или смени ключ/модель.`
      );
    }

    return `Ошибка: лимит запросов Gemini (429) для ${modelName}.`;
  }

  private static cleanResponse(text: string): string {
    let cleaned = text.trim();

    // Prefer a full personalization sentence if present
    const sentence = cleaned.match(
      /((?:Увидел|Обратил внимание|Заметил),?\s+[^.!?\n]{15,}[.!?])/iu
    );
    if (sentence?.[1]) {
      cleaned = sentence[1].trim();
    } else {
      const opener = cleaned.search(/(?:Увидел|Обратил внимание|Заметил)/iu);
      if (opener >= 0) {
        cleaned = cleaned.slice(opener).trim();
      }
    }

    cleaned = cleaned.replace(/^["'«»]+|["'«»]+$/g, '');
    cleaned = cleaned.replace(/\n+/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (cleaned && !/[.!?…]$/.test(cleaned)) {
      cleaned = `${cleaned}.`;
    }

    return cleaned;
  }

  /** Ответ оборван mid-word / слишком короткий кусок */
  private static looksTruncated(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;

    // Ends with a clearly cut word: "занима." "поставщи." "более 2."
    if (/[а-яёa-z]{2,}\.$/iu.test(trimmed)) {
      const lastWord = trimmed.replace(/[.!?…]+$/, '').split(/\s+/).pop() || '';
      // short stem-like endings that look incomplete
      if (
        /^(занима|поставщи|более|специали|разработ|производ|установк|компан)$/iu.test(lastWord) ||
        (lastWord.length <= 4 && !/^(crm|erp|чпу|b2b|api)$/iu.test(lastWord))
      ) {
        return true;
      }
    }

    // Ends with digit + period like "более 2." / "уже 1."
    if (/\b\d+\.$/.test(trimmed)) {
      return true;
    }

    const words = TextCleaningService.countWords(trimmed);
    if (words < 8) {
      return true;
    }

    return false;
  }

  private static processRawResponse(
    raw: string,
    modelUsed: string,
    fullResponse?: unknown
  ): PersonalizationResult {
    Logger.debug(`Gemini [${modelUsed}] RAW: ${raw || '[empty]'}`);

    if (!raw || !raw.trim()) {
      Logger.warn(`Gemini [${modelUsed}]: пустой ответ`);
      if (fullResponse !== undefined) {
        Logger.debug(`Gemini full response: ${JSON.stringify(fullResponse)}`);
      }
      return {
        success: true,
        personalization: 'Ошибка генерации: пустой ответ модели.',
      };
    }

    const cleaned = GeminiProvider.cleanResponse(raw);
    Logger.info(`Gemini [${modelUsed}] результат: ${cleaned || '[empty]'}`);

    if (
      cleaned === FALLBACK_PERSONALIZATION ||
      /не удалось найти достоверный факт/i.test(cleaned)
    ) {
      return { success: true, personalization: FALLBACK_PERSONALIZATION };
    }

    if (GeminiProvider.looksTruncated(cleaned)) {
      Logger.warn(`Gemini [${modelUsed}]: ответ обрезан — "${cleaned}"`);
      return {
        success: true,
        personalization: 'Недостаточно информации: ответ модели обрезан.',
      };
    }

    const validationError = TextCleaningService.getValidationFailureReason(cleaned);
    if (validationError) {
      Logger.warn(`Gemini [${modelUsed}]: валидация не пройдена — ${validationError}`);
      Logger.debug(`Gemini [${modelUsed}] до валидации: "${cleaned}"`);
      return {
        success: true,
        personalization: `Недостаточно информации: ответ модели не прошёл проверку (${validationError}).`,
      };
    }

    return { success: true, personalization: cleaned };
  }

  private static async callGemini(
    modelName: string,
    prompt: string
  ): Promise<{ raw: string; fullResponse: unknown }> {
    await GeminiProvider.waitForRateGap();
    GeminiProvider.requestCount++;

    // Thinking models spend output tokens internally — keep a large budget.
    const maxTokens = Math.max(config.llm.maxTokens, 1024);

    Logger.debug(
      `Gemini запрос #${GeminiProvider.requestCount}, модель: ${modelName}, ` +
      `maxTokens=${maxTokens}, prompt=${prompt.length} символов`
    );

    const client = GeminiProvider.getClient();
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: config.llm.temperature,
        topP: 0.8,
        topK: 20,
      },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text()?.trim() || '';

    return { raw, fullResponse: result.response };
  }

  private static async callGeminiWithRetry(
    modelName: string,
    prompt: string
  ): Promise<{ raw: string; fullResponse: unknown }> {
    try {
      return await GeminiProvider.callGemini(modelName, prompt);
    } catch (error) {
      const message = GeminiProvider.getErrorMessage(error);

      if (
        GeminiProvider.isZeroQuotaError(message) ||
        GeminiProvider.isDailyQuotaError(message) ||
        GeminiProvider.isModelNotFoundError(message)
      ) {
        throw error;
      }

      if (GeminiProvider.isRateLimitError(message)) {
        const delay = GeminiProvider.extractRetryDelayMs(message);
        Logger.warn(`Gemini [${modelName}]: 429, ждём ${Math.ceil(delay / 1000)}s`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await GeminiProvider.callGemini(modelName, prompt);
      }

      throw error;
    }
  }

  private static mapApiError(error: unknown, modelName: string): PersonalizationResult {
    const errorMessage = GeminiProvider.getErrorMessage(error);

    if (GeminiProvider.isModelNotFoundError(errorMessage)) {
      return {
        success: false,
        error: `Ошибка: модель ${modelName} недоступна (404). Смени MODEL в .env.`,
      };
    }

    if (GeminiProvider.isRateLimitError(errorMessage)) {
      const quotaMsg = GeminiProvider.buildQuotaMessage(errorMessage, modelName);

      if (GeminiProvider.isZeroQuotaError(errorMessage) || GeminiProvider.isDailyQuotaError(errorMessage)) {
        GeminiProvider.hardQuotaBlocked = true;
        GeminiProvider.hardQuotaMessage = quotaMsg;
      }

      Logger.error(quotaMsg);
      return { success: false, error: quotaMsg };
    }

    if (errorMessage.includes('API key')) {
      return { success: false, error: 'Invalid Gemini API key' };
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('deadline')) {
      return { success: false, error: 'Gemini request timeout' };
    }

    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return { success: false, error: 'Gemini network error' };
    }

    const shortMessage = errorMessage.split('\n')[0].slice(0, 200);
    return { success: false, error: `Gemini error: ${shortMessage}` };
  }

  async generatePersonalization(prompt: string): Promise<PersonalizationResult> {
    if (GeminiProvider.hardQuotaBlocked) {
      return { success: false, error: GeminiProvider.hardQuotaMessage };
    }

    const modelName = config.llm.model;

    try {
      Logger.debug(`Gemini: модель ${modelName}`);

      let { raw, fullResponse } = await GeminiProvider.callGeminiWithRetry(modelName, prompt);
      let result = GeminiProvider.processRawResponse(raw, modelName, fullResponse);

      const needsRetry =
        result.personalization?.startsWith('Ошибка генерации:') ||
        result.personalization?.startsWith('Недостаточно информации:');

      // Один повтор той же модели — без fallback на мёртвые модели
      if (needsRetry) {
        Logger.info(`Gemini [${modelName}]: повторный запрос из‑за плохого ответа`);
        try {
          ({ raw, fullResponse } = await GeminiProvider.callGeminiWithRetry(modelName, prompt));
          const retryResult = GeminiProvider.processRawResponse(raw, modelName, fullResponse);
          const retryBad =
            retryResult.personalization?.startsWith('Ошибка генерации:') ||
            retryResult.personalization?.startsWith('Недостаточно информации:');
          if (!retryBad) {
            return retryResult;
          }
        } catch (retryError) {
          Logger.warn(`Gemini retry failed: ${GeminiProvider.getErrorMessage(retryError)}`);
        }
      }

      return result;
    } catch (error) {
      return GeminiProvider.mapApiError(error, modelName);
    }
  }
}
