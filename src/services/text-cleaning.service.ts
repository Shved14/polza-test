import * as cheerio from 'cheerio';

export class TextCleaningService {
  private static readonly MAX_TEXT_LENGTH = 8000;
  private static readonly WORD_LIMIT = 40;

  static cleanHTML(html: string): string {
    const $ = cheerio.load(html);

    // Remove script, style, noscript, iframe, svg tags
    $('script, style, noscript, iframe, svg').remove();

    // Remove comments
    $('*').contents().each(function () {
      if (this.type === 'comment') {
        $(this).remove();
      }
    });

    // Get text from body, fallback to full document
    let text = $('body').text() || $.text();

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    return text;
  }

  static truncateText(text: string, maxLength: number = this.MAX_TEXT_LENGTH): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength);
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
      parts.push(`Главная страница:\n${mainPage}`);
    }

    if (aboutPage && aboutPage.length > 0) {
      parts.push(`О компании:\n${aboutPage}`);
    }

    if (newsPage && newsPage.length > 0) {
      parts.push(`Новости:\n${newsPage}`);
    }

    return parts.join('\n\n');
  }
}
