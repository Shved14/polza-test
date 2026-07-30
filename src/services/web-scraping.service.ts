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
    about: [
      'about',
      'about-us',
      'aboutus',
      'company',
      'about-company',
      'our-story',
      'who-we-are',
      'о-компании',
      'о компании',
      'о нас',
      'kompaniya',
      'company-profile',
    ],
  };

  private static readonly ABOUT_PATHS = [
    '/about',
    '/about-us',
    '/aboutus',
    '/company',
    '/about-company',
    '/company-profile',
    '/who-we-are',
    '/our-story',
    '/o-kompanii',
    '/o-nas',
  ];

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

  private static formatFetchError(error: unknown): string {
    if (!axios.isAxiosError(error)) {
      if (error instanceof Error) {
        return `Ошибка: не удалось открыть сайт (${error.message}).`;
      }
      return 'Ошибка: не удалось открыть сайт (неизвестная ошибка).';
    }

    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const code = axiosError.code || '';
    const message = axiosError.message || '';

    if (status === 403) {
      return 'Ошибка: сайт вернул 403 Forbidden (доступ запрещён).';
    }
    if (status === 404) {
      return 'Ошибка: сайт вернул 404 Not Found (страница не найдена).';
    }
    if (status === 401) {
      return 'Ошибка: сайт вернул 401 Unauthorized.';
    }
    if (status === 429) {
      return 'Ошибка: сайт вернул 429 Too Many Requests.';
    }
    if (status && status >= 500) {
      return `Ошибка: сайт вернул ${status} (ошибка сервера).`;
    }

    if (
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      message.toLowerCase().includes('timeout')
    ) {
      return 'Ошибка: таймаут при открытии сайта.';
    }
    if (code === 'ENOTFOUND') {
      return 'Ошибка: домен не найден (DNS).';
    }
    if (code === 'ECONNREFUSED') {
      return 'Ошибка: соединение с сайтом отклонено.';
    }
    if (
      code === 'CERT_HAS_EXPIRED' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      message.toLowerCase().includes('certificate') ||
      message.toLowerCase().includes('ssl') ||
      message.toLowerCase().includes('tls')
    ) {
      return 'Ошибка: проблема с SSL-сертификатом сайта.';
    }

    return `Ошибка: не удалось открыть сайт (${message || code || 'unknown'}).`;
  }

  private static async fetchWithRetry(
    url: string,
    retries: number = config.scraping.maxRetries
  ): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: config.scraping.timeout,
          headers: {
            'User-Agent': this.USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
          },
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400,
        });

        return typeof response.data === 'string' ? response.data : String(response.data);
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

  private static findPageByKeywords(
    $: cheerio.CheerioAPI,
    baseUrl: string,
    keywords: string[]
  ): string | null {
    const links = $('a').toArray();

    for (const link of links) {
      const $link = $(link);
      const href = $link.attr('href');
      if (!href) continue;

      const text = $link.text().toLowerCase().trim();
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

  private static async fetchAboutPage(
    baseUrl: string,
    $: cheerio.CheerioAPI
  ): Promise<string> {
    const candidates: string[] = [];

    const fromLinks = this.findPageByKeywords($, baseUrl, this.PAGE_KEYWORDS.about);
    if (fromLinks) {
      candidates.push(fromLinks);
    }

    const origin = new URL(baseUrl).origin;
    for (const path of this.ABOUT_PATHS) {
      candidates.push(`${origin}${path}`);
    }

    const seen = new Set<string>();
    let attempts = 0;
    const maxAttempts = 5;

    for (const url of candidates) {
      if (attempts >= maxAttempts) {
        break;
      }

      const normalized = url.replace(/\/$/, '');
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      attempts++;

      try {
        const aboutHtml = await this.fetchWithRetry(url, 1);
        const blocked = TextCleaningService.detectBlockedPage(aboutHtml);
        if (blocked) {
          continue;
        }

        const aboutText = TextCleaningService.cleanHTML(aboutHtml);
        if (aboutText.trim().length >= 80) {
          return TextCleaningService.truncateText(aboutText, 2000);
        }
      } catch {
        continue;
      }
    }

    return '';
  }

  static async scrapeWebsite(website: string): Promise<ScrapingResult> {
    try {
      const normalizedUrl = this.normalizeUrl(website);
      const validation = this.validateUrl(normalizedUrl);

      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      let html: string;
      try {
        html = await this.fetchWithRetry(normalizedUrl);
      } catch (error) {
        return { success: false, error: this.formatFetchError(error) };
      }

      if (!html || html.trim().length === 0) {
        return { success: false, error: 'Пустая страница: HTML ответ пуст.' };
      }

      const blocked = TextCleaningService.detectBlockedPage(html);
      if (blocked) {
        return { success: false, error: blocked };
      }

      const $ = cheerio.load(html);
      const mainPageText = TextCleaningService.cleanHTML(html);

      if (!mainPageText || mainPageText.trim().length < 40) {
        return { success: false, error: 'Пустая страница: не удалось извлечь полезный текст.' };
      }

      const truncatedMainText = TextCleaningService.truncateText(mainPageText, 3500);

      let aboutPageText = '';
      try {
        aboutPageText = await this.fetchAboutPage(normalizedUrl, $);
      } catch {
        aboutPageText = '';
      }

      const data: ScrapedData = {
        mainPageText: truncatedMainText,
        aboutPageText,
        newsPageText: '',
      };

      return { success: true, data };
    } catch (error) {
      return { success: false, error: this.formatFetchError(error) };
    }
  }
}
