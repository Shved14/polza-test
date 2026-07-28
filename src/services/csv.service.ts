import * as fs from 'fs';
import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { z } from 'zod';
import { CompanyData, CompanyDataWithPersonalization } from '../types/index.js';
import { Logger } from '../utils/logger.js';

const CompanyDataSchema = z.object({
  company: z.string().min(1, 'Company name is required').max(200),
  website: z.string().min(1, 'Website is required').url('Invalid URL format'),
  email: z.string().email('Invalid email format'),
});

export class CSVService {
  static async readCSV(filePath: string): Promise<CompanyData[]> {
    return new Promise((resolve, reject) => {
      const results: CompanyData[] = [];
      const errors: string[] = [];

      if (!fs.existsSync(filePath)) {
        console.error('--------------------------------');
        console.error('CSV Read Error:');
        console.error('--------------------------------');
        console.error('File path:', filePath);
        console.error('Error: File not found');
        console.error('--------------------------------');
        reject(new Error(`File not found: ${filePath}`));
        return;
      }

      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => {
          const company = row['Компания'] || row['company'] || '';
          const website = row['Сайт'] || row['website'] || '';
          const email = row['Email'] || row['email'] || '';

          try {
            const validated = CompanyDataSchema.parse({
              company: company.trim(),
              website: website.trim(),
              email: email.trim(),
            });
            results.push(validated);
          } catch (error) {
            if (error instanceof z.ZodError) {
              console.error('--------------------------------');
              console.error('CSV Row Validation Error:');
              console.error('--------------------------------');
              console.error('Row:', row);
              console.error('Error:', error);
              console.error('Errors:', error.errors);
              console.error('--------------------------------');
              errors.push(`Row validation error: ${error.errors.map(e => e.message).join(', ')}`);
            }
          }
        })
        .on('end', () => {
          if (errors.length > 0) {
            Logger.warn(`CSV validation warnings: ${errors.length} rows skipped`);
          }
          resolve(results);
        })
        .on('error', (error: Error) => {
          console.error('--------------------------------');
          console.error('CSV Read Error:');
          console.error('--------------------------------');
          console.error('File path:', filePath);
          console.error('Error:', error);
          console.error('message:', error.message);
          console.error('stack:', error.stack);
          console.error('--------------------------------');
          reject(error);
        });
    });
  }

  static async writeCSV(
    filePath: string,
    data: CompanyDataWithPersonalization[]
  ): Promise<void> {
    try {
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
    } catch (error) {
      console.error('--------------------------------');
      console.error('CSV Write Error:');
      console.error('--------------------------------');
      console.error('File path:', filePath);
      console.error('Error:', error);
      console.error('message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('--------------------------------');

      throw error;
    }
  }
}
