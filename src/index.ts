import * as path from 'path';
import { CSVService } from './services/csv.service';
import { WebScrapingService } from './services/web-scraping.service';
import { OpenAIService } from './services/openai.service';
import { Logger } from './utils/logger';
import { validateConfig } from './config/config';
import { CompanyDataWithPersonalization } from './types';

const INPUT_FILE = path.join(__dirname, '../input/companies.csv');
const OUTPUT_FILE = path.join(__dirname, '../output/result.csv');

async function processCompany(
  company: CompanyDataWithPersonalization,
  index: number,
  total: number
): Promise<CompanyDataWithPersonalization> {
  Logger.setProgress(index + 1, total);
  Logger.logProgress();
  Logger.logFetchingWebsite();

  const scrapingResult = await WebScrapingService.scrapeWebsite(company.website);

  if (!scrapingResult.success || !scrapingResult.data) {
    Logger.logError(scrapingResult.error || 'Ошибка скрапинга');
    company.personalization = 'Не удалось получить данные с сайта';
    return company;
  }

  Logger.logFetchingText();
  Logger.logSendingToOpenAI();

  const openaiResult = await OpenAIService.generatePersonalization(
    scrapingResult.data.mainPageText,
    scrapingResult.data.aboutPageText,
    scrapingResult.data.newsPageText
  );

  if (!openaiResult.success) {
    Logger.logError(openaiResult.error || 'Ошибка OpenAI');
    company.personalization = 'Не удалось найти достоверную информацию для персонализации.';
    return company;
  }

  company.personalization = openaiResult.personalization || 'Не удалось найти достоверную информацию для персонализации.';
  Logger.logPersonalizationReceived();
  Logger.logSeparator();

  return company;
}

async function main(): Promise<void> {
  try {
    validateConfig();

    Logger.log('Начинаем обработку...');
    Logger.logSeparator();

    const companies = await CSVService.readCSV(INPUT_FILE);

    if (companies.length === 0) {
      Logger.logError('CSV файл пуст или не содержит данных');
      return;
    }

    Logger.log(`Найдено компаний: ${companies.length}`);
    Logger.logSeparator();

    const results: CompanyDataWithPersonalization[] = [];

    for (let i = 0; i < companies.length; i++) {
      const companyData: CompanyDataWithPersonalization = {
        ...companies[i],
        personalization: '',
      };

      try {
        const processed = await processCompany(companyData, i, companies.length);
        results.push(processed);
      } catch (error) {
        Logger.logError(`Ошибка при обработке компании ${companyData.company}: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
        companyData.personalization = 'Не удалось найти достоверную информацию для персонализации.';
        results.push(companyData);
      }
    }

    await CSVService.writeCSV(OUTPUT_FILE, results);

    Logger.logSeparator();
    Logger.log(`Обработка завершена. Результат сохранен в: ${OUTPUT_FILE}`);
    Logger.log(`Успешно обработано: ${results.filter((r) => r.personalization && !r.personalization.startsWith('Не удалось')).length}/${results.length}`);
  } catch (error) {
    Logger.logError(`Критическая ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    process.exit(1);
  }
}

main();
