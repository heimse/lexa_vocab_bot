import { prisma } from '../db.js';
import type { ChatMessage } from './chat.js';

const HISTORY_LIMIT = 20;

export async function getChatHistory(
  userId: string,
  limit = HISTORY_LIMIT,
): Promise<ChatMessage[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return messages.reverse().map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }));
}

export async function appendChatMessages(userId: string, messages: ChatMessage[]): Promise<void> {
  // createMany не гарантирует порядок createdAt — пишем последовательно
  for (const message of messages) {
    await prisma.chatMessage.create({
      data: { userId, role: message.role, content: message.content },
    });
  }
}

export async function clearChatHistory(userId: string): Promise<void> {
  await prisma.chatMessage.deleteMany({ where: { userId } });
}
