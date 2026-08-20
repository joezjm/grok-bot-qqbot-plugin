export type ReplyScope = "c2c" | "group";

export interface ReplyTarget {
  scope: ReplyScope;
  targetId: string;
  msgId?: string;
}

export interface InboundMessage {
  kind: string;
  senderId: string;
  senderName?: string;
  content: string;
  messageId: string;
  replyTarget?: ReplyTarget;
}

export type PendingStatus = "pending" | "replied";

export interface PendingEvent {
  id: string;
  kind: string;
  senderId: string;
  senderName?: string;
  content: string;
  messageId: string;
  replyTarget?: ReplyTarget;
  receivedAt: string;
  status: PendingStatus;
  seenByWait?: boolean;
}

export interface SendImageSource {
  url?: string;
  localPath?: string;
}

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface QQBotClient {
  on(event: string, handler: (...args: unknown[]) => unknown): QQBotClient;
  start(signal?: AbortSignal): Promise<void>;
  stop(): void;
  sendText(target: ReplyTarget, text: string): Promise<unknown>;
  sendImage(
    target: ReplyTarget,
    source: { url: string } | { localPath: string },
    options?: { content?: string },
  ): Promise<unknown>;
}

export interface QQBotOptions {
  appId: string;
  appSecret: string;
  logger: Logger;
  markdownSupport: boolean;
}

export type CreateQQBot = (options: QQBotOptions) => QQBotClient;

export interface BotStatus {
  configured: boolean;
  running: boolean;
  ready: boolean;
  pendingCount: number;
  lastError?: string;
  appIdHint?: string;
}

export const stderrLogger: Logger = {
  info: (msg, meta) => {
    console.error(msg, meta ?? "");
  },
  error: (msg, meta) => {
    console.error(msg, meta ?? "");
  },
  warn: (msg, meta) => {
    console.error(msg, meta ?? "");
  },
  debug: (msg, meta) => {
    console.error(msg, meta ?? "");
  },
};

export const silentLogger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};
