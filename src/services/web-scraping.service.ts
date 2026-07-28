import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import ipaddr from 'ipaddr.js';
import { ScrapingResult, ScrapedData } from '../types/index.js';
import { TextCleaningService } from './text-cleaning.service.js';
import { config } from '../config/config.js';

export class WebScrapingService {
  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  private static readonly PAGE_KEYWORDS = {
    about: ['about', 'about-us', 'company', 'о-компании', 'о нас', 'about-company', 'our-story', 'who-we-are'],
    news: ['news', 'blog', 'press', 'media', 'новости', 'блог', 'insights', 'updates']
  };

  private static normalizeUrl(url: string): string {
    url = url.trim();
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

  private static isPrivateIP(hostname: string): boolean {
    try {
      const addr = ipaddr.parse(hostname);
      return addr.range() === 'loopback' ||
        addr.range() === 'private' ||
        addr.range() === 'linkLocal';
    } catch {
      return false;
    }
  }

  private static validateUrl(url: string): { valid: boolean; error?: string } {
    if (!this.isValidUrl(url)) {
      return { valid: false, error: 'Invalid URL format' };
    }

    const parsed = new URL(url);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only http and https protocols are allowed' };
    }

    if (this.isPrivateIP(parsed.hostname)) {
      return { valid: false, error: 'Private IP addresses are not allowed' };
    }

    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      return { valid: false, error: 'Localhost is not allowed' };
    }

    if (parsed.hostname.includes('metadata')) {
      return { valid: false, error: 'Metadata endpoints are not allowed' };
    }

    return { valid: true };
  }

  private static async fetchWithRetry(url: string, retries: number = config.scraping.maxRetries): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: config.scraping.timeout,
          headers: {
            'User-Agent': this.USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        return response.data;
      } catch (error) {
        if (attempt === retries) throw error;

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          const isRetryable =
            !axiosError.response ||
            axiosError.response.status >= 500 ||
            axiosError.code === 'ECONNABORTED' ||
            axiosError.code === 'ETIMEDOUT' ||
            axiosError.code === 'ENOTFOUND';

          if (!isRetryable) throw error;
        }

        const delay = config.scraping.retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries exceeded');
  }

  private static findPageByKeywords($: cheerio.CheerioAPI, baseUrl: string, keywords: string[]): string | null {
    const links = $('a').toArray();

    for (const link of links) {
      const $link = $(link);
      const href = $link.attr('href');
      if (!href) continue;

      const text = $link.text().toLowerCase();
      const hrefLower = href.toLowerCase();

      for (const keyword of keywords) {
        if (text.includes(keyword) || hrefLower.includes(keyword)) {
          try {
            const fullUrl = new URL(href, baseUrl).href;
            if (this.validateUrl(fullUrl).valid) {
              return fullUrl;
            }
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
      const validation = this.validateUrl(normalizedUrl);

      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const html = await this.fetchWithRetry(normalizedUrl);

      if (!html || html.trim().length === 0) {
        return { success: false, error: 'Empty HTML response' };
      }

      const $ = cheerio.load(html);
      const baseUrl = new URL(normalizedUrl);

      const mainPageText = TextCleaningService.cleanHTML(html);


      const truncatedMainText = TextCleaningService.truncateText(mainPageText);

      const aboutPageUrl = this.findPageByKeywords($, baseUrl.href, this.PAGE_KEYWORDS.about);
      let aboutPageText = '';
      if (aboutPageUrl) {
        try {
          const aboutHtml = await this.fetchWithRetry(aboutPageUrl);
          aboutPageText = TextCleaningService.cleanHTML(aboutHtml);
          aboutPageText = TextCleaningService.truncateText(aboutPageText, 2000);
        } catch {
          aboutPageText = '';
        }
      }

      const newsPageUrl = this.findPageByKeywords($, baseUrl.href, this.PAGE_KEYWORDS.news);
      let newsPageText = '';
      if (newsPageUrl) {
        try {
          const newsHtml = await this.fetchWithRetry(newsPageUrl);
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


      return { success: true, data };
    } catch (error) {
      throw error;
    }
  }
}
