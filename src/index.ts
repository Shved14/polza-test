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

let isShuttingDown = false;

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
  const scrapingResult = await WebScrapingService.scrapeWebsite(company.website);

  if (!scrapingResult.success || !scrapingResult.data) {
    throw new Error(`Scraping failed for ${company.company}: ${scrapingResult.error}`);
  }

  const combinedText = TextCleaningService.combineTexts(
    scrapingResult.data.mainPageText,
    scrapingResult.data.aboutPageText,
    scrapingResult.data.newsPageText
  );

  if (!combinedText || combinedText.trim().length === 0) {
    throw new Error(`No text content found for ${company.company}`);
  }

  const minimizedText = TextCleaningService.minimizeForAI(combinedText);

  const prompt = `Напиши персонализацию для email. Используй только факты из текста. 1-2 предложения. Максимум 40 слов. На русском языке. Только текст персонализации.

Текст:
${minimizedText}`;

  const llmResult = await llmProvider.generatePersonalization(prompt);

  if (!llmResult.success) {
    throw new Error(`LLM generation failed for ${company.company}: ${llmResult.error}`);
  }

  company.personalization = llmResult.personalization || 'Unable to find reliable information for personalization.';

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
          throw error;
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
    const successful = results.filter(r => r.personalization && !r.personalization.startsWith('Unable to find')).length;
    Logger.info(`Successfully processed: ${successful}/${results.length}`);
  } catch (error) {
    Logger.error(`Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

main();
