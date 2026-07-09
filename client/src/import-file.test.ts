import { describe, expect, it } from 'vitest';
import { extractWordsFromFile } from './import-file.js';

describe('extractWordsFromFile', () => {
  it('CSV: пропускает заголовок, берёт первую колонку, читает кавычки', () => {
    const csv = 'word,translation\n"look forward to",ждать\ncompelling,убедительный';
    expect(extractWordsFromFile(csv)).toEqual(['look forward to', 'compelling']);
  });

  it('TSV из Anki: пропускает директивы и вычищает HTML', () => {
    const anki = '#separator:tab\n#html:true\nwidmo\t<b>призрак</b>\nzamek\tзамок';
    expect(extractWordsFromFile(anki)).toEqual(['widmo', 'zamek']);
  });

  it('простой список: убирает пустые строки и дубликаты', () => {
    expect(extractWordsFromFile('alpha\nbeta\n\nAlpha\n')).toEqual(['alpha', 'beta']);
  });

  it('CSV с точкой с запятой', () => {
    expect(extractWordsFromFile('uno;один\ndos;два')).toEqual(['uno', 'dos']);
  });

  it('игнорирует слишком длинные строки-мусор', () => {
    expect(extractWordsFromFile('x'.repeat(200) + '\nokay')).toEqual(['okay']);
  });
});
