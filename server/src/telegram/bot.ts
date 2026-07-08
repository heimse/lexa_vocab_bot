import { Bot, InlineKeyboard, type Context } from 'grammy';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { parseEntries, importEntries } from '../vocabulary/service.js';
import { getReviewQueue, submitReview, countDue, type ReviewCard } from '../review/service.js';
import { chat, type ChatMessage } from '../ai/chat.js';

const INBOX_TITLE = 'Telegram';

// Состояние сессий в памяти процесса (MVP)
const reviewSessions = new Map<string, { cards: ReviewCard[]; done: number }>();
const chatHistories = new Map<string, ChatMessage[]>();

async function resolveUser(ctx: Context): Promise<{ id: string } | null> {
  const from = ctx.from;
  if (!from || from.is_bot) return null;
  return prisma.user.upsert({
    where: { telegramId: BigInt(from.id) },
    update: { username: from.username ?? null, firstName: from.first_name },
    create: {
      telegramId: BigInt(from.id),
      username: from.username,
      firstName: from.first_name,
    },
    select: { id: true },
  });
}

async function getInboxNotebook(userId: string): Promise<string> {
  const existing = await prisma.notebook.findFirst({
    where: { userId, title: INBOX_TITLE },
  });
  if (existing) return existing.id;
  const created = await prisma.notebook.create({
    data: {
      userId,
      title: INBOX_TITLE,
      emoji: '📥',
      description: 'Слова, добавленные из Telegram',
    },
  });
  return created.id;
}

function formatCardAnswer(card: ReviewCard): string {
  const lines = [`<b>${card.text}</b>`];
  if (card.partOfSpeech) lines.push(`<i>${card.partOfSpeech}</i>`);
  lines.push('', `➡️ ${card.translation ?? ''}`);
  if (card.explanation) lines.push('', card.explanation);
  if (card.examples.length > 0) lines.push('', ...card.examples.map((e) => `• ${e}`));
  if (card.synonyms.length > 0) lines.push('', `Синонимы: ${card.synonyms.join(', ')}`);
  return lines.join('\n');
}

const ratingKeyboard = new InlineKeyboard()
  .text('❌ Не помню', 'rate:AGAIN')
  .text('😓 Трудно', 'rate:HARD')
  .row()
  .text('🙂 Хорошо', 'rate:GOOD')
  .text('😎 Легко', 'rate:EASY');

async function sendNextCard(ctx: Context, userId: string): Promise<void> {
  const session = reviewSessions.get(userId);
  const card = session?.cards[0];
  if (!session || !card) {
    reviewSessions.delete(userId);
    await ctx.reply(
      session ? `Готово! 🎉 Повторено карточек: ${session.done}.` : 'Сессия не найдена. /review',
    );
    return;
  }
  await ctx.reply(`<b>${card.text}</b>${card.state === 0 ? '\n<i>новое слово</i>' : ''}`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('👁 Показать ответ', 'reveal'),
  });
}

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.command('start', async (ctx) => {
    await resolveUser(ctx);
    await ctx.reply(
      [
        'Привет! Я LEXA — личная память для иностранных слов. 🧠',
        '',
        'Команды:',
        '/add слово — добавить слово или список слов (каждое с новой строки)',
        '/review — повторить слова',
        '/notebooks — ваши наборы',
        '',
        'Любой другой текст — вопрос AI-тьютору, он знает ваш словарь.',
      ].join('\n'),
    );
  });

  bot.command('add', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    const text = ctx.match;
    const entries = parseEntries(text);
    if (entries.length === 0) {
      await ctx.reply(
        'Напишите слова после команды:\n/add compelling\nили списком, по одному на строку.',
      );
      return;
    }
    if (entries.length > 200) {
      await ctx.reply('Слишком много слов за раз, лимит — 200.');
      return;
    }
    const notebookId = await getInboxNotebook(user.id);
    const result = await importEntries(user.id, notebookId, entries);
    await ctx.reply(
      `Принято! Новых слов: ${result.created}, уже были в словаре: ${result.linked}.\n` +
        `AI заполняет карточки — они появятся в наборе «📥 ${INBOX_TITLE}».`,
    );
  });

  bot.command('notebooks', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    const notebooks = await prisma.notebook.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    if (notebooks.length === 0) {
      await ctx.reply(
        'Наборов пока нет. Добавьте слова через /add — я создам набор автоматически.',
      );
      return;
    }
    await ctx.reply(
      notebooks.map((n) => `${n.emoji ?? '📖'} ${n.title} — ${n._count.items} слов`).join('\n'),
    );
  });

  bot.command('review', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    const queue = await getReviewQueue(user.id);
    if (queue.total === 0) {
      await ctx.reply('🎉 На сегодня всё! Нет слов для повторения.');
      return;
    }
    reviewSessions.set(user.id, { cards: [...queue.due, ...queue.fresh], done: 0 });
    await ctx.reply(`Слов к повторению: ${queue.total}. Поехали!`);
    await sendNextCard(ctx, user.id);
  });

  bot.callbackQuery('reveal', async (ctx) => {
    const user = await resolveUser(ctx);
    const session = user && reviewSessions.get(user.id);
    const card = session?.cards[0];
    await ctx.answerCallbackQuery();
    if (!card) {
      await ctx.editMessageText('Сессия устарела. Начните заново: /review');
      return;
    }
    await ctx.editMessageText(formatCardAnswer(card), {
      parse_mode: 'HTML',
      reply_markup: ratingKeyboard,
    });
  });

  bot.callbackQuery(/^rate:(AGAIN|HARD|GOOD|EASY)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    const session = user && reviewSessions.get(user.id);
    const card = session?.cards.shift();
    await ctx.answerCallbackQuery();
    if (!user || !session || !card) {
      await ctx.editMessageText('Сессия устарела. Начните заново: /review');
      return;
    }
    const rating = ctx.match[1] as 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';
    await submitReview(user.id, card.id, rating);
    if (rating === 'AGAIN') {
      session.cards.push(card); // забытое слово вернётся в конце сессии
    } else {
      session.done++;
    }
    await ctx.editMessageReplyMarkup(); // убираем кнопки у отвеченной карточки
    await sendNextCard(ctx, user.id);
  });

  // Свободный текст → AI-тьютор
  bot.on('message:text', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    const history = chatHistories.get(user.id) ?? [];
    history.push({ role: 'user', content: ctx.message.text.slice(0, 4000) });

    await ctx.replyWithChatAction('typing');
    let answer = '';
    try {
      await chat(user.id, history.slice(-10), (delta) => {
        answer += delta;
      });
    } catch (err) {
      console.error('Telegram AI chat error:', err);
      await ctx.reply('Ошибка AI, попробуйте ещё раз.');
      return;
    }
    history.push({ role: 'assistant', content: answer });
    chatHistories.set(user.id, history.slice(-10));
    await ctx.reply(answer || '…');
  });

  bot.catch((err) => {
    console.error('Telegram bot error:', err.error);
  });

  return bot;
}

// --- Ежедневное уведомление о повторении ---

const NOTIFY_HOUR = 10; // локальное время сервера
const notifiedOn = new Map<string, string>();

export function startDailyNotifications(bot: Bot): void {
  setInterval(
    async () => {
      const now = new Date();
      if (now.getHours() !== NOTIFY_HOUR) return;
      const today = now.toDateString();

      const users = await prisma.user.findMany({ select: { id: true, telegramId: true } });
      for (const user of users) {
        if (notifiedOn.get(user.id) === today) continue;
        const due = await countDue(user.id);
        if (due === 0) continue;
        try {
          await bot.api.sendMessage(
            Number(user.telegramId),
            `📚 Пора повторить слова! Сегодня ждут: ${due}. Отправьте /review`,
          );
        } catch {
          // пользователь не открывал бота — пропускаем
        }
        notifiedOn.set(user.id, today);
      }
    },
    15 * 60 * 1000,
  );
}
