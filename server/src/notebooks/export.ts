import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

export interface ExportItem {
  text: string;
  language: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  level: string | null;
  explanation: string | null;
  examples: string[];
  synonyms: string[];
  antonyms: string[];
}

// --- CSV ---

function csvField(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(items: ExportItem[]): string {
  const header = [
    'word',
    'language',
    'translation',
    'part_of_speech',
    'level',
    'explanation',
    'examples',
    'synonyms',
    'antonyms',
  ];
  const rows = items.map((item) =>
    [
      item.text,
      item.language ?? '',
      item.translation ?? '',
      item.partOfSpeech ?? '',
      item.level ?? '',
      item.explanation ?? '',
      item.examples.join(' | '),
      item.synonyms.join(' | '),
      item.antonyms.join(' | '),
    ]
      .map(csvField)
      .join(','),
  );
  // BOM — чтобы Excel корректно открыл UTF-8
  return '﻿' + [header.join(','), ...rows].join('\r\n');
}

// --- TXT ---

export function toTxt(title: string, items: ExportItem[]): string {
  const blocks = items.map((item) => {
    const lines = [`${item.text} — ${item.translation ?? '?'}`];
    const meta = [item.partOfSpeech, item.level].filter(Boolean).join(', ');
    if (meta) lines.push(`  ${meta}`);
    if (item.explanation) lines.push(`  ${item.explanation}`);
    for (const example of item.examples) lines.push(`  • ${example}`);
    if (item.synonyms.length > 0) lines.push(`  Синонимы: ${item.synonyms.join(', ')}`);
    if (item.antonyms.length > 0) lines.push(`  Антонимы: ${item.antonyms.join(', ')}`);
    return lines.join('\n');
  });
  return [`${title} — ${items.length} слов`, ...blocks].join('\n\n') + '\n';
}

// --- PDF ---

export function streamPdf(res: Response, title: string, items: ExportItem[]): void {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.registerFont('regular', path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.pipe(res);

  doc.font('bold').fontSize(18).text(title);
  doc.font('regular').fontSize(10).fillColor('#666').text(`${items.length} слов`);
  doc.moveDown(1.5);

  for (const item of items) {
    doc.fillColor('#000').font('bold').fontSize(12).text(item.text, { continued: true });
    doc.font('regular').text(`  —  ${item.translation ?? '?'}`);

    const meta = [item.partOfSpeech, item.level].filter(Boolean).join(', ');
    if (meta) doc.fontSize(9).fillColor('#666').text(meta);
    if (item.explanation) doc.fontSize(10).fillColor('#333').text(item.explanation);
    for (const example of item.examples) {
      doc.fontSize(10).fillColor('#333').text(`• ${example}`, { indent: 10 });
    }
    if (item.synonyms.length > 0) {
      doc
        .fontSize(9)
        .fillColor('#666')
        .text(`Синонимы: ${item.synonyms.join(', ')}`);
    }
    doc.moveDown(0.8);
  }

  doc.end();
}
