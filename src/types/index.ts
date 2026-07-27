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

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export interface AppConfig {
  openai: OpenAIConfig;
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

export interface ProcessingError {
  company: string;
  website: string;
  error: string;
}
