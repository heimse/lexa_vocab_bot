import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { parseEntries, importEntries } from '../vocabulary/service.js';
import { getReviewQueue, submitReview, countDue, type ReviewCard } from '../review/service.js';
import { chat, type ChatMessage } from '../ai/chat.js';

const INBOX_TITLE = 'Telegram';

// Состояние сессий в памяти процесса (MVP)
const reviewSessions = new Map<string, { cards: ReviewCard[]; done: number }>();
const chatHistories = new Map<string, ChatMessage[]>();
const pendingAdds = new Map<string, string[]>();
const awaitingWords = new Set<string>();

const BUTTONS = {
  review: '🔁 Повторение',
  add: '➕ Добавить слова',
  notebooks: '📚 Наборы',
  settings: '⚙️ Настройки',
} as const;

const mainKeyboard = new Keyboard()
  .text(BUTTONS.review)
  .text(BUTTONS.add)
  .row()
  .text(BUTTONS.notebooks)
  .text(BUTTONS.settings)
  .resized()
  .persistent();

const BOT_LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
  uk: 'Українська',
  pl: 'Polski',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
};

const DUE_PRESETS = [10, 20, 30, 50, 100];
const NEW_PRESETS = [0, 5, 10, 20, 50];

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

  void bot.api.setMyCommands([
    { command: 'add', description: 'Добавить слово или список слов' },
    { command: 'review', description: 'Повторить слова' },
    { command: 'notebooks', description: 'Мои наборы' },
    { command: 'settings', description: 'Настройки' },
  ]);

  bot.command('start', async (ctx) => {
    await resolveUser(ctx);
    await ctx.reply(
      [
        'Привет! Я LEXA — личная память для иностранных слов. 🧠',
        '',
        'Управляйте кнопками внизу или командами:',
        '/add слово — добавить слово или список слов (каждое с новой строки)',
        '/review — повторить слова',
        '/notebooks — ваши наборы',
        '/settings — настройки (язык переводов, дневные лимиты)',
        '',
        'Любой другой текст — вопрос AI-тьютору, он знает ваш словарь.',
      ].join('\n'),
      { reply_markup: mainKeyboard },
    );
  });

  const startAddFlow = async (ctx: Context, user: { id: string }, text: string) => {
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

    const notebooks = await prisma.notebook.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    // Наборов ещё нет — кладём во «входящие» без вопросов
    if (notebooks.length === 0) {
      const notebookId = await getInboxNotebook(user.id);
      const result = await importEntries(user.id, notebookId, entries);
      await ctx.reply(
        `Принято! Новых слов: ${result.created}, уже были в словаре: ${result.linked}.\n` +
          `AI заполняет карточки — они появятся в наборе «📥 ${INBOX_TITLE}».`,
      );
      return;
    }

    pendingAdds.set(user.id, entries);
    const keyboard = new InlineKeyboard();
    for (const n of notebooks) {
      keyboard.text(`${n.emoji ?? '📖'} ${n.title}`, `addto:${n.id}`).row();
    }
    if (!notebooks.some((n) => n.title === INBOX_TITLE)) {
      keyboard.text(`📥 ${INBOX_TITLE} (создать)`, 'addto:inbox').row();
    }
    keyboard.text('✖️ Отмена', 'addcancel');
    await ctx.reply(
      `Куда добавить ${entries.length === 1 ? `«${entries[0]}»` : `слова (${entries.length})`}?`,
      { reply_markup: keyboard },
    );
  };

  bot.command('add', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    await startAddFlow(ctx, user, ctx.match);
  });

  bot.callbackQuery('addcancel', async (ctx) => {
    const user = await resolveUser(ctx);
    if (user) pendingAdds.delete(user.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Отменено.');
  });

  bot.callbackQuery(/^addto:(.+)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const entries = pendingAdds.get(user.id);
    if (!entries) {
      await ctx.editMessageText('Список устарел — отправьте /add заново.');
      return;
    }

    let notebookId: string;
    let label: string;
    if (ctx.match[1] === 'inbox') {
      notebookId = await getInboxNotebook(user.id);
      label = `📥 ${INBOX_TITLE}`;
    } else {
      const notebook = await prisma.notebook.findFirst({
        where: { id: ctx.match[1], userId: user.id },
      });
      if (!notebook) {
        await ctx.editMessageText('Набор не найден — отправьте /add заново.');
        return;
      }
      notebookId = notebook.id;
      label = `${notebook.emoji ?? '📖'} ${notebook.title}`;
    }

    pendingAdds.delete(user.id);
    const result = await importEntries(user.id, notebookId, entries);
    await ctx.editMessageText(
      `Принято в «${label}»! Новых слов: ${result.created}, уже были в словаре: ${result.linked}.\n` +
        'AI заполняет карточки.',
    );
  });

  const showNotebooks = async (ctx: Context, user: { id: string }) => {
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
  };

  bot.command('notebooks', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    await showNotebooks(ctx, user);
  });

  const settingsOverview = async (userId: string) => {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { nativeLanguage: true, dailyDueLimit: true, dailyNewLimit: true },
    });
    return {
      text: [
        '⚙️ Настройки',
        '',
        `🌐 Родной язык: ${BOT_LANGUAGE_NAMES[u.nativeLanguage] ?? u.nativeLanguage}`,
        `📆 Повторений в день: ${u.dailyDueLimit}`,
        `🆕 Новых слов в день: ${u.dailyNewLimit}`,
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('🌐 Сменить язык', 'set:lang')
        .row()
        .text('📆 Повторения', 'set:due')
        .text('🆕 Новые слова', 'set:new'),
    };
  };

  const showSettings = async (ctx: Context, user: { id: string }) => {
    const { text, keyboard } = await settingsOverview(user.id);
    await ctx.reply(text, { reply_markup: keyboard });
  };

  bot.command('settings', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    await showSettings(ctx, user);
  });

  bot.callbackQuery('set:menu', async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const { text, keyboard } = await settingsOverview(user.id);
    await ctx.editMessageText(text, { reply_markup: keyboard });
  });

  bot.callbackQuery('set:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard();
    const codes = Object.keys(BOT_LANGUAGE_NAMES);
    for (let i = 0; i < codes.length; i += 2) {
      for (const code of codes.slice(i, i + 2)) {
        keyboard.text(BOT_LANGUAGE_NAMES[code]!, `setlang:${code}`);
      }
      keyboard.row();
    }
    keyboard.text('← Назад', 'set:menu');
    await ctx.editMessageText('Родной язык (на него переводятся новые слова):', {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^setlang:(\w{2})$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const code = ctx.match[1]!;
    if (!BOT_LANGUAGE_NAMES[code]) return;
    await prisma.user.update({ where: { id: user.id }, data: { nativeLanguage: code } });
    const { text, keyboard } = await settingsOverview(user.id);
    await ctx.editMessageText(text, { reply_markup: keyboard });
  });

  const limitPicker = (label: string, presets: number[], action: string) => {
    const keyboard = new InlineKeyboard();
    for (const n of presets) keyboard.text(String(n), `${action}:${n}`);
    keyboard.row().text('← Назад', 'set:menu');
    return { label, keyboard };
  };

  bot.callbackQuery('set:due', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { label, keyboard } = limitPicker('Максимум повторений в день:', DUE_PRESETS, 'setdue');
    await ctx.editMessageText(label, { reply_markup: keyboard });
  });

  bot.callbackQuery('set:new', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { label, keyboard } = limitPicker('Максимум новых слов в день:', NEW_PRESETS, 'setnew');
    await ctx.editMessageText(label, { reply_markup: keyboard });
  });

  bot.callbackQuery(/^set(due|new):(\d+)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const value = Number(ctx.match[2]);
    await prisma.user.update({
      where: { id: user.id },
      data: ctx.match[1] === 'due' ? { dailyDueLimit: value || 1 } : { dailyNewLimit: value },
    });
    const { text, keyboard } = await settingsOverview(user.id);
    await ctx.editMessageText(text, { reply_markup: keyboard });
  });

  const startReview = async (ctx: Context, user: { id: string }) => {
    const queue = await getReviewQueue(user.id);
    if (queue.total === 0) {
      await ctx.reply('🎉 На сегодня всё! Нет слов для повторения.');
      return;
    }
    reviewSessions.set(user.id, { cards: [...queue.due, ...queue.fresh], done: 0 });
    await ctx.reply(`Слов к повторению: ${queue.total}. Поехали!`);
    await sendNextCard(ctx, user.id);
  };

  bot.command('review', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    await startReview(ctx, user);
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

  // Кнопки основной клавиатуры и свободный текст
  bot.on('message:text', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    const text = ctx.message.text;

    switch (text) {
      case BUTTONS.review:
        await startReview(ctx, user);
        return;
      case BUTTONS.notebooks:
        await showNotebooks(ctx, user);
        return;
      case BUTTONS.settings:
        await showSettings(ctx, user);
        return;
      case BUTTONS.add:
        awaitingWords.add(user.id);
        await ctx.reply('Отправьте слова или фразы — по одному на строку.');
        return;
    }

    // Ждём список слов после нажатия «Добавить слова»
    if (awaitingWords.delete(user.id)) {
      await startAddFlow(ctx, user, text);
      return;
    }

    // Иначе — вопрос AI-тьютору
    const history = chatHistories.get(user.id) ?? [];
    history.push({ role: 'user', content: text.slice(0, 4000) });

    await ctx.replyWithChatAction('typing');
    let answer = '';
    try {
      await chat(user.id, history.slice(-10), (delta) => {
        answer += delta;
      });
    } catch (err) {
      logger.error({ err }, 'Telegram AI chat error');
      await ctx.reply('Ошибка AI, попробуйте ещё раз.');
      return;
    }
    history.push({ role: 'assistant', content: answer });
    chatHistories.set(user.id, history.slice(-10));
    await ctx.reply(answer || '…');
  });

  bot.catch((err) => {
    logger.error({ err: err.error }, 'Telegram bot error');
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
