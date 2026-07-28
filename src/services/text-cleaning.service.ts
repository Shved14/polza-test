import * as cheerio from 'cheerio';
import { config } from '../config/config.js';

export class TextCleaningService {
  private static readonly WORD_LIMIT = 40;

  static cleanHTML(html: string): string {
    const $ = cheerio.load(html);

    // Remove script, style, noscript tags
    $('script').remove();
    $('style').remove();
    $('noscript').remove();

    // Get text from body
    const text = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    return text;
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

  static combineTexts(mainPage: string, aboutPage: string, newsPage: string): string {
    const parts: string[] = [];

    if (mainPage && mainPage.length > 0) {
      parts.push(`Main page:\n${mainPage}`);
    }

    if (aboutPage && aboutPage.length > 0) {
      parts.push(`About:\n${aboutPage}`);
    }

    if (newsPage && newsPage.length > 0) {
      parts.push(`News:\n${newsPage}`);
    }

    return parts.join('\n\n');
  }

  static minimizeForAI(text: string): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const topSentences = sentences.slice(0, 5);
    return topSentences.join('. ').trim();
  }
}
