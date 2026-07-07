export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface CurrentUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
}

export interface AuthConfig {
  botUsername: string | null;
  devMode: boolean;
}

export interface Notebook {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  createdAt: string;
  wordCount: number;
}

export interface NotebookWord {
  id: string;
  text: string;
  language: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  level: string | null;
  aiStatus: 'PENDING' | 'READY' | 'FAILED';
  status: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  addedAt: string;
}

export interface NotebookDetail {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  createdAt: string;
  items: NotebookWord[];
}
