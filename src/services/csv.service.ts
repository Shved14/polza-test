import * as fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { CompanyData, CompanyDataWithPersonalization } from '../types';

export class CSVService {
  static async readCSV(filePath: string): Promise<CompanyData[]> {
    return new Promise((resolve, reject) => {
      const results: CompanyData[] = [];

      if (!fs.existsSync(filePath)) {
        reject(new Error(`File not found: ${filePath}`));
        return;
      }

      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => {
          results.push({
            company: row['Компания'] || row['company'] || '',
            website: row['Сайт'] || row['website'] || '',
            email: row['Email'] || row['email'] || '',
          });
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error: Error) => {
          reject(error);
        });
    });
  }

  static async writeCSV(
    filePath: string,
    data: CompanyDataWithPersonalization[]
  ): Promise<void> {
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'company', title: 'Компания' },
        { id: 'website', title: 'Сайт' },
        { id: 'email', title: 'Email' },
        { id: 'personalization', title: 'Персонализация' },
      ],
    });

    await csvWriter.writeRecords(data);
  }
}
