import { esc } from '../util.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// История живёт, пока открыта вкладка (персистентность чата — v2)
const history: ChatMessage[] = [];

const SUGGESTIONS = [
  'Что означает compelling?',
  'Чем отличаются say и tell?',
  'Проверь меня по словам из Ведьмака',
  'Какие слова мне повторить сегодня?',
];

export function renderChat(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page chat-page">
      <div class="chat-messages" id="chat-messages"></div>
      <form class="chat-form" id="chat-form">
        <input id="chat-input" type="text" placeholder="Спросите о слове, грамматике или своём словаре…"
          autocomplete="off" maxlength="4000" />
        <button type="submit" class="btn btn-primary" id="chat-send">➤</button>
      </form>
    </section>
  `;

  const messagesEl = container.querySelector<HTMLDivElement>('#chat-messages')!;
  const form = container.querySelector<HTMLFormElement>('#chat-form')!;
  const input = container.querySelector<HTMLInputElement>('#chat-input')!;
  const sendButton = container.querySelector<HTMLButtonElement>('#chat-send')!;

  const appendMessage = (role: ChatMessage['role'], content: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = `chat-msg chat-${role}`;
    el.textContent = content;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  };

  const renderHistory = (): void => {
    messagesEl.innerHTML = '';
    if (history.length === 0) {
      messagesEl.innerHTML = `
        <div class="chat-empty">
          <p class="muted">AI-тьютор знает ваш словарь. Попробуйте:</p>
          ${SUGGESTIONS.map((s) => `<button class="btn chat-suggestion">${esc(s)}</button>`).join('')}
        </div>
      `;
      messagesEl
        .querySelectorAll<HTMLButtonElement>('.chat-suggestion')
        .forEach((b) => b.addEventListener('click', () => void send(b.textContent ?? '')));
      return;
    }
    for (const message of history) appendMessage(message.role, message.content);
  };

  const send = async (text: string): Promise<void> => {
    const content = text.trim();
    if (!content) return;
    input.value = '';
    input.disabled = true;
    sendButton.disabled = true;

    if (history.length === 0) messagesEl.innerHTML = '';
    history.push({ role: 'user', content });
    appendMessage('user', content);
    const assistantEl = appendMessage('assistant', '…');

    let answer = '';
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-20) }),
      });
      if (!res.ok || !res.body) throw new Error('Сервер недоступен');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          if (!event.startsWith('data: ')) continue;
          const payload = JSON.parse(event.slice(6)) as {
            delta?: string;
            error?: string;
            done?: boolean;
          };
          if (payload.delta) {
            answer += payload.delta;
            assistantEl.textContent = answer;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          if (payload.error) throw new Error(payload.error);
        }
      }
      if (!answer) throw new Error('Пустой ответ');
      history.push({ role: 'assistant', content: answer });
    } catch (err) {
      assistantEl.textContent = err instanceof Error ? err.message : 'Ошибка';
      assistantEl.classList.add('error');
      if (answer) history.push({ role: 'assistant', content: answer });
    } finally {
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void send(input.value);
  });

  renderHistory();
  input.focus();
}
