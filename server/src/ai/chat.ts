import OpenAI from 'openai';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { LANGUAGE_NAMES } from './cards.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const MAX_TOOL_ROUNDS = 5;

const systemPrompt = (
  nativeLanguageName: string,
) => `Ты — LEXA, дружелюбный AI-тьютор по иностранным языкам в приложении-словаре.
Родной язык пользователя — ${nativeLanguageName}. Отвечай на нём, если пользователь не просит иначе.
У тебя есть инструменты для доступа к личному словарю пользователя: используй их,
когда вопрос касается его слов, наборов или плана повторений.
Проверяя пользователя по словам, задавай по одному вопросу за раз и жди ответа.
Отвечай кратко и по делу, без лишних вступлений.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_vocabulary',
      description: 'Поиск слов в словаре пользователя по подстроке (в тексте слова или переводе)',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Строка поиска' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notebooks',
      description: 'Список наборов пользователя с количеством слов',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_notebook_words',
      description: 'Слова из набора пользователя (поиск набора по названию)',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: 'Название набора или его часть' } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_review_words',
      description: 'Слова, которые пользователю нужно повторить сегодня',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const wordSummary = {
  text: true,
  translation: true,
  partOfSpeech: true,
  level: true,
  status: true,
} as const;

async function runTool(userId: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'search_vocabulary': {
      const query = String(args.query ?? '');
      return prisma.vocabularyItem.findMany({
        where: {
          userId,
          OR: [
            { text: { contains: query, mode: 'insensitive' } },
            { translation: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: wordSummary,
        take: 30,
      });
    }
    case 'list_notebooks': {
      const notebooks = await prisma.notebook.findMany({
        where: { userId },
        include: { _count: { select: { items: true } } },
      });
      return notebooks.map((n) => ({ title: n.title, emoji: n.emoji, words: n._count.items }));
    }
    case 'get_notebook_words': {
      const title = String(args.title ?? '');
      const notebook = await prisma.notebook.findFirst({
        where: { userId, title: { contains: title, mode: 'insensitive' } },
        include: { items: { include: { vocabularyItem: { select: wordSummary } } } },
      });
      if (!notebook) return { error: 'Набор не найден' };
      return {
        title: notebook.title,
        words: notebook.items.map((i) => i.vocabularyItem),
      };
    }
    case 'get_review_words': {
      const now = new Date();
      const [due, fresh] = await Promise.all([
        prisma.vocabularyItem.findMany({
          where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: now } },
          select: wordSummary,
          take: 20,
        }),
        prisma.vocabularyItem.findMany({
          where: { userId, aiStatus: 'READY', state: 0 },
          select: wordSummary,
          take: 10,
        }),
      ]);
      return { due, fresh };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Прогоняет диалог через модель с инструментами.
 * Текстовые дельты ответа передаются в onDelta по мере генерации.
 */
export async function chat(
  userId: string,
  history: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nativeLanguage: true },
  });
  const languageName = LANGUAGE_NAMES[user?.nativeLanguage ?? 'ru'] ?? 'Russian';

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(languageName) },
    ...history,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await openai.chat.completions.create({
      model: config.openaiChatModel,
      messages,
      tools: TOOLS,
      stream: true,
    });

    let content = '';
    const toolCalls: { id: string; name: string; arguments: string }[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        toolCalls[tc.index] ??= { id: '', name: '', arguments: '' };
        const call = toolCalls[tc.index]!;
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.arguments += tc.function.arguments;
      }
    }

    if (toolCalls.length === 0) return;

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
      } catch {
        // оставляем пустые аргументы
      }
      const result = await runTool(userId, tc.name, args);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  onDelta('\n\n_(достигнут лимит обращений к словарю)_');
}
