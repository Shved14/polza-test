export interface CompanyData {
  company: string;
  website: string;
  email: string;
}

export interface CompanyDataWithPersonalization extends CompanyData {
  personalization: string;
}

export interface ScrapedData {
  mainPageText: string;
  aboutPageText: string;
  newsPageText: string;
}

export interface LLMConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ScrapingConfig {
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  maxTextLength: number;
  concurrency: number;
}

export interface AppConfig {
  llm: LLMConfig;
  scraping: ScrapingConfig;
}

export interface ScrapingResult {
  success: boolean;
  data?: ScrapedData;
  error?: string;
}

export interface PersonalizationResult {
  success: boolean;
  personalization?: string;
  error?: string;
}

export interface LLMProvider {
  generatePersonalization(prompt: string): Promise<PersonalizationResult>;
}
