/**
 * Извлекает слова из CSV/TSV/TXT-экспорта (включая Anki "Notes in Plain Text").
 * Берётся первое поле каждой строки; строки-заголовки и комментарии пропускаются.
 */

const HEADER_WORDS = new Set(['word', 'words', 'text', 'front', 'term', 'слово', 'слова']);

function detectDelimiter(sample: string): string {
  const counts: [string, number][] = [
    ['\t', (sample.match(/\t/g) ?? []).length],
    [';', (sample.match(/;/g) ?? []).length],
    [',', (sample.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : '\n';
}

function firstField(line: string, delimiter: string): string {
  let field: string;
  if (line.startsWith('"')) {
    // Закрывающая кавычка с учётом экранирования ""
    const match = line.slice(1).match(/^((?:[^"]|"")*)"/);
    field = match ? match[1]!.replaceAll('""', '"') : line;
  } else {
    field = delimiter === '\n' ? line : (line.split(delimiter)[0] ?? '');
  }
  // Anki добавляет HTML — вычищаем теги
  return field
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function extractWordsFromFile(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const delimiter = detectDelimiter(lines.slice(0, 20).join('\n'));

  const words: string[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.startsWith('#')) continue; // Anki: строки-директивы начинаются с #
    const word = firstField(line, delimiter);
    if (!word || word.length > 100) continue;
    if (index === 0 && HEADER_WORDS.has(word.toLowerCase())) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words;
}
