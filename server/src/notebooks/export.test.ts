import { describe, expect, it } from 'vitest';
import { toCsv, toTxt, type ExportItem } from './export.js';

const item = (overrides: Partial<ExportItem> = {}): ExportItem => ({
  text: 'destiny',
  language: 'en',
  translation: 'судьба',
  partOfSpeech: 'noun',
  level: 'B1',
  explanation: 'Events that will happen.',
  examples: ['Believe in destiny.'],
  synonyms: ['fate'],
  antonyms: [],
  ...overrides,
});

describe('toCsv', () => {
  it('содержит BOM, заголовок и данные', () => {
    const csv = toCsv([item()]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [header, row] = csv.slice(1).split('\r\n');
    expect(header).toBe(
      'word,language,translation,part_of_speech,level,explanation,examples,synonyms,antonyms',
    );
    expect(row).toContain('destiny,en,судьба,noun,B1');
  });

  it('экранирует запятые и кавычки', () => {
    const csv = toCsv([item({ translation: 'судьба, рок', explanation: 'He said "fate"' })]);
    expect(csv).toContain('"судьба, рок"');
    expect(csv).toContain('"He said ""fate"""');
  });
});

describe('toTxt', () => {
  it('содержит заголовок с числом слов и карточку', () => {
    const txt = toTxt('Ведьмак', [item()]);
    expect(txt).toContain('Ведьмак — 1 слов');
    expect(txt).toContain('destiny — судьба');
    expect(txt).toContain('  • Believe in destiny.');
    expect(txt).toContain('  Синонимы: fate');
    expect(txt).not.toContain('Антонимы:');
  });
});
