import dotenv from 'dotenv';
dotenv.config();

import { WebScrapingService } from './dist/services/web-scraping.service.js';
import { TextCleaningService } from './dist/services/text-cleaning.service.js';
import { GeminiProvider } from './dist/services/gemini.provider.js';

const SITES = [
  'https://iskroline.ru',
  'https://hnc.su',
];

function buildPrompt(textForLlm) {
  return `Ты специалист по B2B email outreach.

Тебе дан текст, извлеченный с сайта компании.

Нужно написать персонализацию для первого холодного письма.

Правила:
1. Используй ТОЛЬКО факты из текста. Ничего не придумывай.
2. Если сайт на английском или китайском — пиши персонализацию на русском по фактам с сайта.
3. Если фактов недостаточно — personalization должен быть ровно:
Не удалось найти достоверный факт для персонализации.
4. Русский язык.
5. Ровно одно предложение.
6. Не более 25 слов.
7. Без кавычек внутри текста.
8. Без markdown.
9. Не используй слова: возможно, скорее всего, кажется.
10. Начинай с: Увидел, что / Обратил внимание, что / Заметил, что

Верни ТОЛЬКО валидный JSON без markdown, без code block, без пояснений, без мыслей:

{"personalization":"..."}

Примеры значения personalization:
Увидел, что вы развиваете платформу для автоматизации продаж и CRM.
Обратил внимание, что вы предлагаете облачную ERP для малого и среднего бизнеса.
Заметил, что ваша компания производит токарные и фрезерные станки с ЧПУ.

Текст сайта:
${textForLlm}`;
}

function isValidRussianPersonalization(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    text.startsWith('Увидел') ||
    text.startsWith('Обратил') ||
    text.startsWith('Заметил')
  );
}

async function processSite(url, provider) {
  console.log('\n========================================');
  console.log(`SITE: ${url}`);
  console.log('========================================');

  const scrapingResult = await WebScrapingService.scrapeWebsite(url);
  if (!scrapingResult.success || !scrapingResult.data) {
    console.error('Scrape failed:', scrapingResult.error || 'no data');
    return { url, ok: false, personalization: null, error: scrapingResult.error };
  }

  const combinedText = TextCleaningService.combineTexts(
    scrapingResult.data.mainPageText,
    scrapingResult.data.aboutPageText
  );
  const textForLlm = TextCleaningService.truncateText(combinedText, 2200);
  console.log(`Combined/truncated text length: ${textForLlm.length}`);

  const prompt = buildPrompt(textForLlm);
  const llmResult = await provider.generatePersonalization(prompt);

  console.log('LLM success:', llmResult.success);
  if (!llmResult.success) {
    console.error('LLM error:', llmResult.error);
    return { url, ok: false, personalization: null, error: llmResult.error };
  }

  const personalization = llmResult.personalization || '';
  console.log('PERSONALIZATION RESULT:', personalization);
  const ok = isValidRussianPersonalization(personalization);
  console.log('Valid (Увидел/Обратил/Заметил):', ok);
  return { url, ok, personalization, error: null };
}

async function main() {
  const provider = new GeminiProvider();
  const results = [];

  for (const url of SITES) {
    try {
      results.push(await processSite(url, provider));
    } catch (err) {
      console.error(`Fatal for ${url}:`, err instanceof Error ? err.message : err);
      results.push({ url, ok: false, personalization: null, error: String(err) });
    }
  }

  console.log('\n========================================');
  console.log('SMOKE SUMMARY');
  console.log('========================================');
  for (const r of results) {
    console.log(`${r.url}: ok=${r.ok} | ${r.personalization || r.error || 'n/a'}`);
  }

  const allOk = results.every((r) => r.ok);
  console.log('ALL_OK=', allOk);
  process.exit(allOk ? 0 : 1);
}

main();