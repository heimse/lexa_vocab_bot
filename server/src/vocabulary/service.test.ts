import { describe, expect, it } from 'vitest';
import { parseEntries } from './service.js';

describe('parseEntries', () => {
  it('разбивает по строкам, чистит пробелы и пустые строки', () => {
    expect(parseEntries('  destiny  \n\n  look   forward   to \n')).toEqual([
      'destiny',
      'look forward to',
    ]);
  });

  it('убирает дубликаты без учёта регистра, сохраняя первое написание', () => {
    expect(parseEntries('Destiny\ndestiny\nDESTINY\ncurse')).toEqual(['Destiny', 'curse']);
  });

  it('пустой ввод даёт пустой список', () => {
    expect(parseEntries('\n  \n\t\n')).toEqual([]);
  });
});
