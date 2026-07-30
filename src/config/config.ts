import dotenv from 'dotenv';
import { AppConfig } from '../types/index.js';

dotenv.config();

export const config: AppConfig = {
  llm: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.MODEL || 'gemini-2.5-flash-lite',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1024', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
  },
  scraping: {
    timeout: parseInt(process.env.SCRAPING_TIMEOUT || '10000', 10),
    maxRetries: parseInt(process.env.SCRAPING_MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.SCRAPING_RETRY_DELAY || '1000', 10),
    maxTextLength: parseInt(process.env.SCRAPING_MAX_TEXT_LENGTH || '6000', 10),
    concurrency: parseInt(process.env.SCRAPING_CONCURRENCY || '3', 10),
  },
};

export function validateConfig(): void {
  if (!config.llm.apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  if (config.llm.maxTokens < 50 || config.llm.maxTokens > 4000) {
    throw new Error('LLM_MAX_TOKENS must be between 50 and 4000');
  }

  if (config.llm.temperature < 0 || config.llm.temperature > 2) {
    throw new Error('LLM_TEMPERATURE must be between 0 and 2');
  }

  if (config.scraping.concurrency < 1 || config.scraping.concurrency > 10) {
    throw new Error('SCRAPING_CONCURRENCY must be between 1 and 10');
  }
}
