import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { ScrapingResult, ScrapedData } from '../types';
import { TextCleaningService } from './text-cleaning.service';

export class WebScrapingService {
  private static readonly TIMEOUT = 10000;
  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

  private static normalizeUrl(url: string): string {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`;
    }
    return url;
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private static async fetchPage(url: string): Promise<string> {
    const response = await axios.get(url, {
      timeout: this.TIMEOUT,
      headers: {
        'User-Agent': this.USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    return response.data;
  }

  private static findAboutPage($: cheerio.CheerioAPI, baseUrl: string): string | null {
    const aboutKeywords = ['about', 'о-компании', 'о нас', 'about-us', 'about-us', 'company'];
    
    for (const link of $('a')) {
      const href = $(link).attr('href');
      if (!href) continue;

      const text = $(link).text().toLowerCase();
      const hrefLower = href.toLowerCase();

      for (const keyword of aboutKeywords) {
        if (text.includes(keyword) || hrefLower.includes(keyword)) {
          try {
            return new URL(href, baseUrl).href;
          } catch {
            continue;
          }
        }
      }
    }
    return null;
  }

  private static findNewsPage($: cheerio.CheerioAPI, baseUrl: string): string | null {
    const newsKeywords = ['news', 'blog', 'новости', 'блог', 'press', 'media'];
    
    for (const link of $('a')) {
      const href = $(link).attr('href');
      if (!href) continue;

      const text = $(link).text().toLowerCase();
      const hrefLower = href.toLowerCase();

      for (const keyword of newsKeywords) {
        if (text.includes(keyword) || hrefLower.includes(keyword)) {
          try {
            return new URL(href, baseUrl).href;
          } catch {
            continue;
          }
        }
      }
    }
    return null;
  }

  static async scrapeWebsite(website: string): Promise<ScrapingResult> {
    try {
      const normalizedUrl = this.normalizeUrl(website);

      if (!this.isValidUrl(normalizedUrl)) {
        return {
          success: false,
          error: 'Некорректный URL',
        };
      }

      const html = await this.fetchPage(normalizedUrl);
      
      if (!html || html.trim().length === 0) {
        return {
          success: false,
          error: 'Пустой HTML',
        };
      }

      const $ = cheerio.load(html);
      const baseUrl = new URL(normalizedUrl);

      const mainPageText = TextCleaningService.cleanHTML(html);
      const truncatedMainText = TextCleaningService.truncateText(mainPageText);

      const aboutPageUrl = this.findAboutPage($, baseUrl.href);
      let aboutPageText = '';
      if (aboutPageUrl) {
        try {
          const aboutHtml = await this.fetchPage(aboutPageUrl);
          aboutPageText = TextCleaningService.cleanHTML(aboutHtml);
          aboutPageText = TextCleaningService.truncateText(aboutPageText, 2000);
        } catch {
          aboutPageText = '';
        }
      }

      const newsPageUrl = this.findNewsPage($, baseUrl.href);
      let newsPageText = '';
      if (newsPageUrl) {
        try {
          const newsHtml = await this.fetchPage(newsPageUrl);
          newsPageText = TextCleaningService.cleanHTML(newsHtml);
          newsPageText = TextCleaningService.truncateText(newsPageText, 2000);
        } catch {
          newsPageText = '';
        }
      }

      const data: ScrapedData = {
        mainPageText: truncatedMainText,
        aboutPageText,
        newsPageText,
      };

      return {
        success: true,
        data,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 404) {
          return {
            success: false,
            error: 'Страница не найдена (404)',
          };
        }
        if (axiosError.code === 'ECONNABORTED') {
          return {
            success: false,
            error: 'Таймаут соединения',
          };
        }
        if (axiosError.code === 'ENOTFOUND') {
          return {
            success: false,
            error: 'Сайт не найден',
          };
        }
        return {
          success: false,
          error: `Ошибка сети: ${axiosError.message}`,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка',
      };
    }
  }
}
