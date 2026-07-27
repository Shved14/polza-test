import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export const config: AppConfig = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.MODEL || 'gpt-3.5-turbo',
  },
};

export function validateConfig(): void {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }
}
