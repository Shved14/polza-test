import * as cheerio from 'cheerio';
import { config } from '../config/config.js';

export class TextCleaningService {
  private static readonly WORD_LIMIT = 25;

  private static readonly NOISE_PATTERNS = [
    /cookie/i,
    /оставить заявк/i,
    /заказать звонок/i,
    /privacy policy/i,
    /политик[аи] конфиденциальност/i,
    /subscribe/i,
    /newsletter/i,
    /все права защищены/i,
    /all rights reserved/i,
    /we use cookies/i,
    /наш сайт использует cookies/i,
    /использует cookies/i,
    /яндекс.?метрик/i,
    /согласие на обработку/i,
    /accept all cookies/i,
    /manage cookies/i,
  ];

  static detectBlockedPage(html: string): string | null {
    const lower = html.toLowerCase();

    if (
      lower.includes('checking your browser') ||
      lower.includes('just a moment') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('cf-challenge') ||
      lower.includes('attention required! | cloudflare') ||
      (lower.includes('cloudflare') && (
        lower.includes('enable javascript') ||
        lower.includes('ray id') ||
        lower.includes('cf-ray')
      ))
    ) {
      return 'Сайт защищен Cloudflare.';
    }

    if (
      lower.includes('please enable javascript') ||
      lower.includes('enable javascript to continue') ||
      lower.includes('this site requires javascript') ||
      lower.includes('you need to enable javascript') ||
      lower.includes('javascript is disabled')
    ) {
      return 'Сайт требует JavaScript и недоступен для парсинга.';
    }

    if (
      lower.includes('captcha') &&
      (lower.includes('verify you are human') || lower.includes('are you a robot'))
    ) {
      return 'Сайт требует прохождения captcha.';
    }

    return null;
  }

  private static isNoise(text: string, minLength = 20): boolean {
    if (text.length < minLength) {
      return true;
    }

    const cookieHit = this.NOISE_PATTERNS.some((pattern) => pattern.test(text));
    if (!cookieHit) {
      return false;
    }

    // Short CTA/cookie snippets are always noise.
    if (text.length < 200) {
      return true;
    }

    // Long blocks that are mostly a consent banner are still noise.
    const lower = text.toLowerCase();
    const consentSignals = [
      'cookie',
      'cookies',
      'соглас',
      'политик',
      'персональных данных',
      'метрик',
    ].filter((signal) => lower.includes(signal)).length;

    return consentSignals >= 2;
  }

  private static isUselessMeta(text: string): boolean {
    const cleaned = text.replace(/[.\s…]+/g, '').trim();
    return cleaned.length < 8;
  }

  private static pushUnique(
    parts: string[],
    value?: string | null,
    minLength = 20
  ): void {
    if (!value) {
      return;
    }

    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned || this.isUselessMeta(cleaned) || this.isNoise(cleaned, minLength)) {
      return;
    }

    if (parts.some((part) => part.toLowerCase() === cleaned.toLowerCase())) {
      return;
    }

    parts.push(cleaned);
  }

  private static extractMetaContent($: cheerio.CheerioAPI, selector: string): string {
    return ($(selector).attr('content') || '').trim();
  }

  private static extractContainerText(
    $: cheerio.CheerioAPI,
    selector: string,
    maxChars: number
  ): string {
    const chunks: string[] = [];
    let total = 0;

    const elements = $(selector).toArray();
    for (const el of elements) {
      if (total >= maxChars) {
        break;
      }

      const clone = $(el).clone();
      clone.find('script, style, noscript, footer, nav, form, iframe').remove();

      const text = clone.text().replace(/\s+/g, ' ').trim();
      if (!text || this.isNoise(text, 40)) {
        continue;
      }

      const remaining = maxChars - total;
      const slice = text.length > remaining ? text.slice(0, remaining) : text;
      chunks.push(slice);
      total += slice.length;
    }

    return chunks.join(' ').trim();
  }

  private static stripNoisePhrases(text: string): string {
    let cleaned = text
      .replace(/наш сайт использует cookies[\s\S]{0,300}?(согласен|принять|ok|хорошо)\.?/gi, ' ')
      .replace(/we use cookies[\s\S]{0,300}?(accept|agree|ok)\.?/gi, ' ')
      .replace(/this (website|site) uses cookies[\s\S]{0,300}?(accept|agree|ok)\.?/gi, ' ');

    const sentences = cleaned
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((sentence) => !this.isNoise(sentence, 8));

    return sentences.join(' ').replace(/\s+/g, ' ').trim();
  }

  static cleanHTML(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, noscript, footer, nav, aside, form, iframe, svg').remove();
    $(
      '[class*="cookie"], [id*="cookie"], [class*="footer"], [id*="footer"], ' +
      '[class*="consent"], [id*="consent"], [class*="gdpr"], [id*="gdpr"], ' +
      '[class*="popup"], [id*="popup"], [class*="modal"], [id*="modal"]'
    ).remove();

    const parts: string[] = [];

    // Priority order: title → meta → og → twitter → h1/h2 → main/article/section
    this.pushUnique(parts, $('title').first().text(), 3);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[name="description"]'), 20);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[property="og:title"]'), 3);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[property="og:description"]'), 20);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[name="twitter:title"]'), 3);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[property="twitter:title"]'), 3);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[name="twitter:description"]'), 20);
    this.pushUnique(parts, this.extractMetaContent($, 'meta[property="twitter:description"]'), 20);

    $('h1').each((_, el) => {
      this.pushUnique(parts, $(el).text(), 3);
    });

    $('h2').each((_, el) => {
      this.pushUnique(parts, $(el).text(), 3);
    });

    this.pushUnique(parts, this.extractContainerText($, 'main', 2000), 40);
    this.pushUnique(parts, this.extractContainerText($, 'article', 1500), 40);
    this.pushUnique(parts, this.extractContainerText($, 'section[role="main"]', 1500), 40);

    const sectionText = this.extractContainerText($, 'section', 1500);
    if (sectionText) {
      this.pushUnique(parts, sectionText, 40);
    }

    // Fallback only if structured extraction failed
    if (parts.length < 2) {
      $('[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"]').remove();
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      if (bodyText.length > 80) {
        parts.push(bodyText.slice(0, 2500));
      }
    }

    return this.stripNoisePhrases(parts.join('\n'));
  }

  static truncateText(text: string, maxLength?: number): string {
    const limit = maxLength || config.scraping.maxTextLength;

    if (text.length <= limit) {
      return text;
    }

    const truncated = text.substring(0, limit);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > limit * 0.8) {
      return truncated.substring(0, lastSpace);
    }

    return truncated;
  }

  static countWords(text: string): number {
    return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
  }

  static validatePersonalizationLength(text: string): boolean {
    const wordCount = this.countWords(text);
    return wordCount <= this.WORD_LIMIT;
  }

  static getValidationFailureReason(text: string): string | null {
    const trimmed = text.trim();

    if (!trimmed) {
      return 'пустой ответ';
    }

    if (trimmed.length < 10) {
      return `слишком короткий (${trimmed.length} символов)`;
    }

    const wordCount = this.countWords(trimmed);
    if (wordCount < 4) {
      return `мало слов (${wordCount})`;
    }

    if (wordCount > 45) {
      return `слишком длинный (${wordCount} слов)`;
    }

    if (trimmed.includes('```') || trimmed.includes('###')) {
      return 'содержит markdown';
    }

    if (/<[a-zA-Z/]/.test(trimmed)) {
      return 'содержит HTML-теги';
    }

    const lower = trimmed.toLowerCase();
    if (
      lower.includes('constraint') ||
      lower.includes('lets recount') ||
      lower.includes('word count') ||
      lower.startsWith('скорее всего') ||
      lower.startsWith('возможно') ||
      lower.startsWith('кажется')
    ) {
      return 'запрещённые слова или служебный текст модели';
    }

    if (!/(увидел|обратил внимание|заметил)/i.test(trimmed)) {
      return 'нет типового начала (Увидел/Заметил/Обратил внимание)';
    }

    return null;
  }

  static validatePersonalizationResponse(text: string): boolean {
    return this.getValidationFailureReason(text) === null;
  }

  static combineTexts(mainPage: string, aboutPage: string): string {
    const parts: string[] = [];

    if (mainPage && mainPage.length > 0) {
      parts.push(mainPage);
    }

    if (aboutPage && aboutPage.length > 0) {
      parts.push(`О компании:\n${aboutPage}`);
    }

    return parts.join('\n\n');
  }

  static minimizeForAI(text: string): string {
    return text.trim();
  }
}
