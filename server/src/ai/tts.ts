import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Кэш озвучки на диске: слово меняется редко, а TTS-запросы платные
const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../var/audio');

export async function synthesizeSpeech(cacheKey: string, text: string): Promise<Buffer> {
  const file = path.join(CACHE_DIR, `${cacheKey}.mp3`);
  try {
    return await fs.readFile(file);
  } catch {
    // нет в кэше — генерируем
  }

  const generate = () =>
    openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
    });
  // Сетевые обрывы у TTS-эндпоинта случаются — одна повторная попытка
  const response = await generate().catch(generate);
  const buffer = Buffer.from(await response.arrayBuffer());

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, buffer);
  return buffer;
}
