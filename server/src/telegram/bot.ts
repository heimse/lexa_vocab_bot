import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { parseEntries, importEntries } from '../vocabulary/service.js';
import {
  getReviewQueue,
  submitReview,
  countDue,
  getStreak,
  type ReviewCard,
} from '../review/service.js';
import { chat } from '../ai/chat.js';
import { appendChatMessages, getChatHistory } from '../ai/history.js';

const INBOX_TITLE = 'Telegram';

// Состояние сессий в памяти процесса (MVP)
const reviewSessions = new Map<string, { cards: ReviewCard[]; done: number }>();
const pendingAdds = new Map<string, string[]>();
// Ждём список слов; если указан notebookId — кладём сразу в него, без выбора
const awaitingWords = new Map<string, { notebookId?: string; label?: string }>();
// Ждём название нового набора; entries — слова, которые надо в него положить
const awaitingNotebookTitle = new Map<string, { entries?: string[] }>();
// Ждём новое название существующего набора
const awaitingRename = new Map<string, string>();

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const wordsCount = (n: number) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;

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

  const startAddFlow = async (
    ctx: Context,
    user: { id: string },
    text: string,
    target?: { notebookId: string; label: string },
  ) => {
    const entries = parseEntries(text);
    if (entries.length === 0) {
      await ctx.reply('Не нашёл слов в сообщении. Отправьте слова по одному на строку.');
      return;
    }
    if (entries.length > 200) {
      await ctx.reply('Слишком много слов за раз, лимит — 200.');
      return;
    }

    // Набор уже выбран — добавляем без вопросов
    if (target) {
      const result = await importEntries(user.id, target.notebookId, entries);
      await ctx.reply(
        `Принято в «${target.label}»! Новых слов: ${result.created}, уже были в словаре: ${result.linked}.\n` +
          'AI заполняет карточки.',
      );
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
    keyboard.text('➕ Новый набор', 'addto:new').row();
    keyboard.text('✖️ Отмена', 'addcancel');
    await ctx.reply(
      `Куда добавить ${entries.length === 1 ? `«${entries[0]}»` : `слова (${entries.length})`}?`,
      { reply_markup: keyboard },
    );
  };

  bot.command('add', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    if (!ctx.match.trim()) {
      awaitingWords.set(user.id, {});
      await ctx.reply('Отправьте слова или фразы — по одному на строку. Потом выберете набор.');
      return;
    }
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

    if (ctx.match[1] === 'new') {
      awaitingNotebookTitle.set(user.id, { entries });
      pendingAdds.delete(user.id);
      await ctx.editMessageText(
        'Как назвать новый набор? Можно с эмодзи в начале, например:\n📚 Ведьмак',
      );
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
      await ctx.reply('Наборов пока нет.', {
        reply_markup: new InlineKeyboard().text('➕ Создать набор', 'nb:new'),
      });
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const n of notebooks) {
      keyboard.text(`${n.emoji ?? '📖'} ${n.title} (${n._count.items})`, `nbmenu:${n.id}`).row();
    }
    keyboard.text('➕ Создать набор', 'nb:new');
    await ctx.reply('Ваши наборы — нажмите, чтобы управлять:', { reply_markup: keyboard });
  };

  bot.callbackQuery(/^nbmenu:(.+)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const notebook = await prisma.notebook.findFirst({
      where: { id: ctx.match[1], userId: user.id },
      include: { _count: { select: { items: true } } },
    });
    if (!notebook) {
      await ctx.editMessageText('Набор не найден.');
      return;
    }
    await ctx.editMessageText(
      `${notebook.emoji ?? '📖'} ${notebook.title} — ${wordsCount(notebook._count.items)}`,
      {
        reply_markup: new InlineKeyboard()
          .text('✏️ Переименовать', `nbren:${notebook.id}`)
          .text('🗑 Удалить', `nbdel:${notebook.id}`)
          .row()
          .text('← К списку', 'nb:list'),
      },
    );
  });

  bot.callbackQuery('nb:list', async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    await ctx.deleteMessage().catch(() => {});
    await showNotebooks(ctx, user);
  });

  bot.callbackQuery(/^nbren:(.+)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    awaitingRename.set(user.id, ctx.match[1]!);
    await ctx.editMessageText('Напишите новое название набора (эмодзи в начале станет иконкой):');
  });

  bot.callbackQuery(/^nbdel:(.+)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const notebook = await prisma.notebook.findFirst({
      where: { id: ctx.match[1], userId: user.id },
    });
    if (!notebook) {
      await ctx.editMessageText('Набор не найден.');
      return;
    }
    await ctx.editMessageText(
      `Удалить набор «${notebook.emoji ?? '📖'} ${notebook.title}»?\n` +
        'Слова останутся в словаре и продолжат повторяться.',
      {
        reply_markup: new InlineKeyboard()
          .text('🗑 Да, удалить', `nbdelok:${notebook.id}`)
          .text('← Отмена', `nbmenu:${notebook.id}`),
      },
    );
  });

  bot.callbackQuery(/^nbdelok:(.+)$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const { count } = await prisma.notebook.deleteMany({
      where: { id: ctx.match[1], userId: user.id },
    });
    await ctx.editMessageText(
      count > 0 ? 'Набор удалён. Слова остались в словаре.' : 'Набор не найден.',
    );
  });

  bot.callbackQuery('nb:new', async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    awaitingNotebookTitle.set(user.id, {});
    await ctx.reply('Как назвать новый набор? Можно с эмодзи в начале, например:\n📚 Ведьмак');
  });

  bot.command('notebooks', async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return;
    await showNotebooks(ctx, user);
  });

  const settingsOverview = async (userId: string) => {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        nativeLanguage: true,
        targetLanguage: true,
        dailyDueLimit: true,
        dailyNewLimit: true,
        notifyEnabled: true,
        notifyHour: true,
      },
    });
    const hour = `${String(u.notifyHour).padStart(2, '0')}:00`;
    return {
      text: [
        '⚙️ Настройки',
        '',
        `🎯 Изучаю: ${BOT_LANGUAGE_NAMES[u.targetLanguage] ?? u.targetLanguage}`,
        `🌐 Родной язык: ${BOT_LANGUAGE_NAMES[u.nativeLanguage] ?? u.nativeLanguage}`,
        `📆 Повторений в день: ${u.dailyDueLimit}`,
        `🆕 Новых слов в день: ${u.dailyNewLimit}`,
        `🔔 Напоминание: ${u.notifyEnabled ? `ежедневно в ${hour}` : 'выключено'}`,
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('🎯 Изучаемый язык', 'set:target')
        .text('🌐 Родной язык', 'set:lang')
        .row()
        .text('📆 Повторения', 'set:due')
        .text('🆕 Новые слова', 'set:new')
        .row()
        .text(
          u.notifyEnabled ? '🔕 Выключить напоминание' : '🔔 Включить напоминание',
          'set:notify',
        )
        .row()
        .text('⏰ Время напоминания', 'set:hour')
        .row()
        .text('🗑 Удалить мои данные', 'set:wipe'),
    };
  };

  const languagePicker = (prompt: string, action: string) => {
    const keyboard = new InlineKeyboard();
    const codes = Object.keys(BOT_LANGUAGE_NAMES);
    for (let i = 0; i < codes.length; i += 2) {
      for (const code of codes.slice(i, i + 2)) {
        keyboard.text(BOT_LANGUAGE_NAMES[code]!, `${action}:${code}`);
      }
      keyboard.row();
    }
    keyboard.text('← Назад', 'set:menu');
    return { prompt, keyboard };
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
    const { prompt, keyboard } = languagePicker(
      'Родной язык (на него переводятся новые слова):',
      'setlang',
    );
    await ctx.editMessageText(prompt, { reply_markup: keyboard });
  });

  bot.callbackQuery('set:target', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { prompt, keyboard } = languagePicker('Какой язык вы изучаете?', 'settarget');
    await ctx.editMessageText(prompt, { reply_markup: keyboard });
  });

  bot.callbackQuery(/^set(lang|target):(\w{2})$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const code = ctx.match[2]!;
    if (!BOT_LANGUAGE_NAMES[code]) return;
    await prisma.user.update({
      where: { id: user.id },
      data: ctx.match[1] === 'lang' ? { nativeLanguage: code } : { targetLanguage: code },
    });
    const { text, keyboard } = await settingsOverview(user.id);
    await ctx.editMessageText(text, { reply_markup: keyboard });
  });

  bot.callbackQuery('set:notify', async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { notifyEnabled: true },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { notifyEnabled: !u.notifyEnabled },
    });
    const { text, keyboard } = await settingsOverview(user.id);
    await ctx.editMessageText(text, { reply_markup: keyboard });
  });

  bot.callbackQuery('set:hour', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard();
    const hours = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22];
    hours.forEach((h, i) => {
      keyboard.text(`${String(h).padStart(2, '0')}:00`, `sethour:${h}`);
      if (i % 4 === 3) keyboard.row();
    });
    keyboard.row().text('← Назад', 'set:menu');
    await ctx.editMessageText('Во сколько присылать напоминание?', { reply_markup: keyboard });
  });

  bot.callbackQuery('set:wipe', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '⚠️ Удалить ВСЕ ваши данные?\n\n' +
        'Будут стёрты: наборы, все слова с карточками и вся история повторений. ' +
        'Отменить это действие невозможно.',
      {
        reply_markup: new InlineKeyboard()
          .text('❌ Да, удалить всё', 'wipe:confirm')
          .row()
          .text('← Нет, вернуться', 'set:menu'),
      },
    );
  });

  bot.callbackQuery('wipe:confirm', async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    await prisma.user.delete({ where: { id: user.id } });
    reviewSessions.delete(user.id);
    pendingAdds.delete(user.id);
    awaitingWords.delete(user.id);
    awaitingNotebookTitle.delete(user.id);
    await ctx.editMessageText('Все данные удалены. Отправьте /start, чтобы начать заново.');
  });

  bot.callbackQuery(/^sethour:(\d{1,2})$/, async (ctx) => {
    const user = await resolveUser(ctx);
    await ctx.answerCallbackQuery();
    if (!user) return;
    const hour = Number(ctx.match[1]);
    if (hour < 0 || hour > 23) return;
    await prisma.user.update({
      where: { id: user.id },
      data: { notifyHour: hour, notifyEnabled: true },
    });
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
        awaitingWords.set(user.id, {});
        await ctx.reply('Отправьте слова или фразы — по одному на строку. Потом выберете набор.');
        return;
    }

    // Ждём новое название существующего набора
    const renameId = awaitingRename.get(user.id);
    if (renameId) {
      awaitingRename.delete(user.id);
      const match = text.trim().match(/^(\p{Extended_Pictographic}(?:️)?)?\s*(.{1,100})$/su);
      const title = match?.[2]?.trim();
      if (!title) {
        await ctx.reply('Название не подошло — попробуйте ещё раз (до 100 символов).');
        return;
      }
      const { count } = await prisma.notebook.updateMany({
        where: { id: renameId, userId: user.id },
        data: { title, ...(match?.[1] ? { emoji: match[1] } : {}) },
      });
      await ctx.reply(
        count > 0
          ? `Переименовано: «${match?.[1] ? `${match[1]} ` : ''}${title}»`
          : 'Набор не найден.',
      );
      return;
    }

    // Ждём название нового набора
    const pendingNotebook = awaitingNotebookTitle.get(user.id);
    if (pendingNotebook) {
      awaitingNotebookTitle.delete(user.id);
      const match = text.trim().match(/^(\p{Extended_Pictographic}(?:️)?)?\s*(.{1,100})$/su);
      const title = match?.[2]?.trim();
      if (!title) {
        await ctx.reply('Название не подошло — попробуйте ещё раз (до 100 символов).');
        return;
      }
      const notebook = await prisma.notebook.create({
        data: { userId: user.id, title, emoji: match?.[1] ?? null },
      });
      const label = `${notebook.emoji ?? '📖'} ${notebook.title}`;
      if (pendingNotebook.entries?.length) {
        const result = await importEntries(user.id, notebook.id, pendingNotebook.entries);
        await ctx.reply(
          `Набор «${label}» создан! Новых слов: ${result.created}, уже были в словаре: ${result.linked}.\n` +
            'AI заполняет карточки.',
        );
      } else {
        // Сразу ждём слова в свежесозданный набор
        awaitingWords.set(user.id, { notebookId: notebook.id, label });
        await ctx.reply(
          `Набор «${label}» создан! Теперь отправьте слова — по одному на строку, я добавлю их прямо в него.`,
        );
      }
      return;
    }

    // Ждём список слов (после «Добавить слова», /add или создания набора)
    const addTarget = awaitingWords.get(user.id);
    if (addTarget) {
      awaitingWords.delete(user.id);
      await startAddFlow(
        ctx,
        user,
        text,
        addTarget.notebookId && addTarget.label
          ? { notebookId: addTarget.notebookId, label: addTarget.label }
          : undefined,
      );
      return;
    }

    // Иначе — вопрос AI-тьютору (история общая с сайтом, хранится в БД)
    const userMessage = text.slice(0, 4000);
    await ctx.replyWithChatAction('typing');
    let answer = '';
    try {
      const history = await getChatHistory(user.id, 10);
      await chat(user.id, [...history, { role: 'user', content: userMessage }], (delta) => {
        answer += delta;
      });
    } catch (err) {
      logger.error({ err }, 'Telegram AI chat error');
      await ctx.reply('Ошибка AI, попробуйте ещё раз.');
      return;
    }
    await appendChatMessages(user.id, [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: answer },
    ]);
    await ctx.reply(answer || '…');
  });

  bot.catch((err) => {
    // Повторное нажатие кнопки, не меняющее сообщение, — не ошибка
    if (err.message.includes('message is not modified')) return;
    logger.error({ err: err.error }, 'Telegram bot error');
  });

  return bot;
}

// --- Ежедневное уведомление о повторении ---

const notifiedOn = new Map<string, string>();

export function startDailyNotifications(bot: Bot): void {
  setInterval(
    async () => {
      const now = new Date();
      const today = now.toDateString();

      const users = await prisma.user.findMany({
        where: { notifyEnabled: true, notifyHour: now.getHours() },
        select: { id: true, telegramId: true },
      });
      for (const user of users) {
        if (notifiedOn.get(user.id) === today) continue;
        const due = await countDue(user.id);
        if (due === 0) continue;
        const streak = await getStreak(user.id);
        const streakLine =
          streak > 0
            ? `\n🔥 Ваш стрик: ${streak} ${plural(streak, 'день', 'дня', 'дней')} — не потеряйте!`
            : '';
        try {
          await bot.api.sendMessage(
            Number(user.telegramId),
            `📚 Пора повторить слова! Сегодня ждут: ${due}. Отправьте /review${streakLine}`,
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
