import * as path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import pLimit from 'p-limit';
import * as cliProgress from 'cli-progress';
import { CSVService } from './services/csv.service.js';
import { WebScrapingService } from './services/web-scraping.service.js';
import { GeminiProvider } from './services/gemini.provider.js';
import { TextCleaningService } from './services/text-cleaning.service.js';
import { Logger, LogLevel } from './utils/logger.js';
import { validateConfig, config } from './config/config.js';
import { CompanyDataWithPersonalization } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FALLBACK_PERSONALIZATION = 'Не удалось найти достоверный факт для персонализации.';

let isShuttingDown = false;

function isSuccessfulPersonalization(text: string): boolean {
  if (!text) return false;
  if (text === FALLBACK_PERSONALIZATION) return false;
  if (text.startsWith('Ошибка')) return false;
  if (text.startsWith('Недостаточно информации')) return false;
  if (text.startsWith('Не удалось найти')) return false;
  return true;
}

function formatScrapingError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Ошибка: не удалось открыть сайт (неизвестная ошибка).';
  }

  const message = error.message;

  if (message.includes('403')) {
    return 'Ошибка: сайт вернул 403 Forbidden (доступ запрещён).';
  }
  if (message.includes('404')) {
    return 'Ошибка: сайт вернул 404 Not Found (страница не найдена).';
  }
  if (message.includes('timeout') || message.includes('ETIMEDOUT') || message.includes('ECONNABORTED')) {
    return 'Ошибка: таймаут при открытии сайта.';
  }
  if (message.includes('ENOTFOUND')) {
    return 'Ошибка: домен не найден (DNS).';
  }
  if (message.includes('ECONNREFUSED')) {
    return 'Ошибка: соединение с сайтом отклонено.';
  }
  if (message.includes('certificate') || message.includes('SSL') || message.includes('TLS')) {
    return 'Ошибка: проблема с SSL-сертификатом сайта.';
  }

  return `Ошибка: не удалось открыть сайт (${message}).`;
}

function setupGracefulShutdown(): void {
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    Logger.warn(`Received ${signal}. Graceful shutdown initiated...`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function processCompany(
  company: CompanyDataWithPersonalization,
  llmProvider: GeminiProvider
): Promise<CompanyDataWithPersonalization> {
  let scrapingResult;

  Logger.stage(company.company, 'START', company.website);

  try {
    scrapingResult = await WebScrapingService.scrapeWebsite(company.website);
  } catch (error) {
    company.personalization = formatScrapingError(error);
    Logger.stage(company.company, 'SCRAPE', `ошибка — ${company.personalization}`);
    return company;
  }

  if (!scrapingResult.success || !scrapingResult.data) {
    const scrapeError = scrapingResult.error || 'не удалось получить данные с сайта.';
    company.personalization = scrapeError.startsWith('Ошибка') || scrapeError.startsWith('Сайт')
      ? scrapeError
      : `Ошибка: ${scrapeError}`;
    Logger.stage(company.company, 'SCRAPE', `неуспех — ${company.personalization}`);
    return company;
  }

  const mainLen = scrapingResult.data.mainPageText?.length || 0;
  const aboutLen = scrapingResult.data.aboutPageText?.length || 0;
  Logger.stage(
    company.company,
    'SCRAPE',
    `ok — main=${mainLen} символов, about=${aboutLen} символов`
  );

  const combinedText = TextCleaningService.combineTexts(
    scrapingResult.data.mainPageText,
    scrapingResult.data.aboutPageText
  );

  if (!combinedText || combinedText.trim().length === 0) {
    company.personalization = 'Недостаточно информации: с сайта не удалось извлечь текст.';
    Logger.stage(company.company, 'TEXT', company.personalization);
    return company;
  }

  if (combinedText.trim().length < 50) {
    company.personalization = 'Недостаточно информации: на сайте слишком мало полезного текста.';
    Logger.stage(company.company, 'TEXT', `${company.personalization} (${combinedText.length} симв.)`);
    return company;
  }

  const textForLlm = TextCleaningService.truncateText(combinedText, 4000);
  Logger.stageDebug(
    company.company,
    'TEXT',
    `в LLM ${textForLlm.length} символов, preview: ${textForLlm.slice(0, 120).replace(/\s+/g, ' ')}...`
  );

  const prompt = `Ты пишешь персонализацию для холодного B2B email.

Используй только факты из текста сайта.

Ответ должен быть:

- на русском;
- одно предложение;
- до 25 слов;
- начинаться с "Увидел, что", "Заметил, что" или "Обратил внимание, что".

Если фактов недостаточно, ответь:

Не удалось найти достоверный факт для персонализации.

Верни только текст. Без JSON. Без пояснений.

Текст сайта:
${textForLlm}`;

  Logger.stage(company.company, 'LLM', `запрос, модель=${config.llm.model}`);
  const llmResult = await llmProvider.generatePersonalization(prompt);

  if (!llmResult.success) {
    const llmError = llmResult.error || 'неизвестная ошибка LLM';
    company.personalization = llmError.startsWith('Ошибка')
      ? llmError
      : `Ошибка генерации: ${llmError}`;
    Logger.stage(company.company, 'RESULT', company.personalization);
    return company;
  }

  company.personalization = llmResult.personalization || FALLBACK_PERSONALIZATION;

  if (isSuccessfulPersonalization(company.personalization)) {
    Logger.stage(company.company, 'RESULT', `ok — ${company.personalization}`);
  } else {
    Logger.stage(company.company, 'RESULT', company.personalization);
  }

  return company;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('input', { alias: 'i', type: 'string', description: 'Input CSV file path' })
    .option('output', { alias: 'o', type: 'string', description: 'Output CSV file path' })
    .option('debug', { alias: 'd', type: 'boolean', description: 'Enable debug logging' })
    .help()
    .argv;

  if (argv.debug) {
    Logger.setLevel(LogLevel.DEBUG);
  }

  const inputFile = argv.input || path.join(__dirname, '../input/companies.csv');
  const outputFile = argv.output || path.join(__dirname, '../output/result.csv');

  try {
    validateConfig();
    setupGracefulShutdown();

    Logger.info('Starting email outreach personalization...');
    Logger.logSeparator();

    const companies = await CSVService.readCSV(inputFile);

    if (companies.length === 0) {
      Logger.error('CSV file is empty or contains no data');
      return;
    }

    Logger.info(`Found ${companies.length} companies to process`);
    Logger.info(`Concurrency: ${config.scraping.concurrency}`);
    Logger.info(`Gemini model: ${config.llm.model}`);
    Logger.info(`Gemini maxTokens: ${config.llm.maxTokens}, temperature: ${config.llm.temperature}`);
    Logger.warn(
      'gemini-flash-latest тратит токены на thinking — LLM_MAX_TOKENS лучше >= 1024, иначе ответы обрезаются.'
    );
    Logger.logSeparator();

    const progressBar = new cliProgress.SingleBar({
      format: 'Progress |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
    }, cliProgress.Presets.shades_classic);

    progressBar.start(companies.length, 0);

    const results: CompanyDataWithPersonalization[] = [];
    const limit = pLimit(config.scraping.concurrency);
    const llmProvider = new GeminiProvider();

    const tasks = companies.map((company) =>
      limit(async () => {
        if (isShuttingDown) return null;

        const companyData: CompanyDataWithPersonalization = {
          ...company,
          personalization: '',
        };

        try {
          const processed = await processCompany(companyData, llmProvider);
          progressBar.increment();
          return processed;
        } catch (error) {
          companyData.personalization = formatScrapingError(error);
          Logger.warn(`${company.company}: ${companyData.personalization}`);
          progressBar.increment();
          return companyData;
        }
      })
    );

    const processedResults = await Promise.all(tasks);
    processedResults.forEach(result => {
      if (result) results.push(result);
    });

    progressBar.stop();

    await CSVService.writeCSV(outputFile, results);

    Logger.logSeparator();
    Logger.info(`Processing complete. Results saved to: ${outputFile}`);
    const successful = results.filter(r => isSuccessfulPersonalization(r.personalization)).length;
    const errors = results.filter(r => r.personalization.startsWith('Ошибка')).length;
    const insufficient = results.length - successful - errors;
    Logger.info(`Successfully processed: ${successful}/${results.length}`);
    Logger.info(`Errors: ${errors}, insufficient info: ${insufficient}`);
  } catch (error) {
    Logger.error(`Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

main();
