import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const cardSchema = z.object({
  language: z.string().length(2),
  part_of_speech: z.string().min(1),
  translation: z.string().min(1),
  explanation: z.string().min(1),
  examples: z.array(z.string()).min(1).max(3),
  synonyms: z.array(z.string()).max(5),
  antonyms: z.array(z.string()).max(5),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
});

export type GeneratedCard = z.infer<typeof cardSchema>;

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: {
      type: 'string',
      description: 'ISO 639-1 code of the language the entry is written in, e.g. "en"',
    },
    part_of_speech: {
      type: 'string',
      description:
        'noun, verb, adjective, adverb, phrasal verb, idiom, collocation, expression, etc.',
    },
    translation: {
      type: 'string',
      description: '1-3 best translations into Russian, comma-separated',
    },
    explanation: {
      type: 'string',
      description: 'Short simple explanation of the meaning in the language of the entry',
    },
    examples: {
      type: 'array',
      items: { type: 'string' },
      description: '2-3 natural example sentences in the language of the entry',
    },
    synonyms: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 5 synonyms in the language of the entry',
    },
    antonyms: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 3 antonyms in the language of the entry, empty if none make sense',
    },
    level: {
      type: 'string',
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      description: 'Approximate CEFR difficulty level',
    },
  },
  required: [
    'language',
    'part_of_speech',
    'translation',
    'explanation',
    'examples',
    'synonyms',
    'antonyms',
    'level',
  ],
} as const;

const SYSTEM_PROMPT = `You are a professional lexicographer for a vocabulary learning app.
The learner's native language is Russian.
Given a word, phrase, idiom or phrasal verb, produce a dictionary card for it.
Detect the language of the entry yourself. Keep explanations short and simple.
If the entry contains a typo, correct it silently and describe the corrected form.`;

export async function generateCard(text: string): Promise<GeneratedCard> {
  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'vocabulary_card', strict: true, schema: JSON_SCHEMA },
    },
  });

  const content = response.choices[0]?.message.content;
  if (!content) throw new Error('Empty AI response');
  return cardSchema.parse(JSON.parse(content));
}
