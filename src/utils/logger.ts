export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static current: number = 0;
  private static total: number = 0;
  private static level: LogLevel = LogLevel.INFO;

  static setLevel(level: LogLevel): void {
    this.level = level;
  }

  static setProgress(current: number, total: number): void {
    this.current = current;
    this.total = total;
  }

  private static formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  private static log(level: LogLevel, levelStr: string, message: string): void {
    if (level < this.level) return;

    const formatted = this.formatMessage(levelStr, message);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  static debug(message: string): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message);
  }

  static info(message: string): void {
    this.log(LogLevel.INFO, 'INFO', message);
  }

  static warn(message: string): void {
    this.log(LogLevel.WARN, 'WARN', message);
  }

  static error(message: string): void {
    this.log(LogLevel.ERROR, 'ERROR', message);
  }

  static logProgress(): void {
    this.info(`Processing ${this.current}/${this.total}`);
  }

  static logFetchingWebsite(): void {
    this.debug('Fetching website...');
  }

  static logFetchingText(): void {
    this.debug('Extracting text...');
  }

  static logSendingToOpenAI(): void {
    this.debug('Sending to OpenAI...');
  }

  static logPersonalizationReceived(): void {
    this.debug('Personalization received');
  }

  static logSeparator(): void {
    console.log('---');
  }
}
