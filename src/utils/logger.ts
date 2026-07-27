export class Logger {
  private static current: number = 0;
  private static total: number = 0;

  static setProgress(current: number, total: number): void {
    this.current = current;
    this.total = total;
  }

  static log(message: string): void {
    console.log(message);
  }

  static logProgress(): void {
    console.log(`Обработка ${this.current}/${this.total}`);
  }

  static logFetchingWebsite(): void {
    console.log('Получение сайта...');
  }

  static logFetchingText(): void {
    console.log('Получение текста...');
  }

  static logSendingToOpenAI(): void {
    console.log('Отправка в OpenAI...');
  }

  static logPersonalizationReceived(): void {
    console.log('Получена персонализация.');
  }

  static logError(error: string): void {
    console.error(`Ошибка: ${error}`);
  }

  static logSeparator(): void {
    console.log('---');
  }
}
