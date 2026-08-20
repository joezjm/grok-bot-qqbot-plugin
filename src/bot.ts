import { QQBot } from "@tencent-connect/qqbot-nodejs";
import type {
  BotStatus,
  CreateQQBot,
  InboundMessage,
  Logger,
  PendingEvent,
  QQBotClient,
  ReplyTarget,
  SendImageSource,
} from "./types.js";
import { stderrLogger } from "./types.js";

const MAX_PENDING = 200;

export function resolveReplyTarget(args: {
  target?: { scope?: string; targetId?: string; msgId?: string };
  scope?: string;
  targetId?: string;
  msgId?: string;
}): ReplyTarget {
  const nested = args.target;
  const scope = nested?.scope ?? args.scope;
  const targetId = nested?.targetId ?? args.targetId;
  const msgId = nested?.msgId ?? args.msgId;
  if (scope !== "c2c" && scope !== "group") {
    throw new Error('ReplyTarget.scope must be "c2c" or "group"');
  }
  if (!targetId || typeof targetId !== "string") {
    throw new Error("ReplyTarget.targetId is required");
  }
  const target: ReplyTarget = { scope, targetId };
  if (typeof msgId === "string" && msgId.length > 0) {
    target.msgId = msgId;
  }
  return target;
}

export function resolveImageSource(
  source: SendImageSource,
): { url: string } | { localPath: string } {
  const hasUrl = typeof source.url === "string" && source.url.length > 0;
  const hasPath =
    typeof source.localPath === "string" && source.localPath.length > 0;
  if (hasUrl && hasPath) {
    throw new Error("Provide exactly one of url or localPath");
  }
  if (hasUrl) {
    return { url: source.url as string };
  }
  if (hasPath) {
    return { localPath: source.localPath as string };
  }
  throw new Error("Provide url or localPath for the image");
}

const defaultCreateQQBot: CreateQQBot = (options) =>
  new QQBot({
    appId: options.appId,
    appSecret: options.appSecret,
    logger: options.logger,
    markdownSupport: false,
  }) as unknown as QQBotClient;

export interface BotControllerOptions {
  appId?: string;
  appSecret?: string;
  createQQBot?: CreateQQBot;
  logger?: Logger;
}

export class BotController {
  private readonly appId?: string;
  private readonly appSecret?: string;
  private readonly createQQBot: CreateQQBot;
  private readonly logger: Logger;
  private client?: QQBotClient;
  private abort?: AbortController;
  private startPromise?: Promise<void>;
  private ready = false;
  private running = false;
  private lastError?: string;
  private seq = 0;
  private readonly pending: PendingEvent[] = [];
  private readonly waiters: Array<(event: PendingEvent) => void> = [];

  constructor(options: BotControllerOptions = {}) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.createQQBot = options.createQQBot ?? defaultCreateQQBot;
    this.logger = options.logger ?? stderrLogger;
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    extras: Omit<BotControllerOptions, "appId" | "appSecret"> = {},
  ): BotController {
    return new BotController({
      appId: env.QQBOT_APP_ID?.trim() || undefined,
      appSecret: env.QQBOT_APP_SECRET?.trim() || undefined,
      ...extras,
    });
  }

  getStatus(): BotStatus {
    const pendingCount = this.pending.filter((e) => e.status === "pending").length;
    const status: BotStatus = {
      configured: Boolean(this.appId && this.appSecret),
      running: this.running,
      ready: this.ready,
      pendingCount,
    };
    if (this.lastError) {
      status.lastError = this.lastError;
    }
    if (this.appId) {
      status.appIdHint = this.appId.length <= 4 ? "****" : `…${this.appId.slice(-4)}`;
    }
    return status;
  }

  listPending(limit = 50): PendingEvent[] {
    const items = this.pending.filter((e) => e.status === "pending");
    return items.slice(0, Math.max(0, limit));
  }

  /**
   * Start the QQBot client in the background. Does not await SDK start(),
   * which blocks until stop()/abort.
   */
  startBackground(): void {
    if (this.startPromise || this.running) {
      return;
    }
    if (!this.appId || !this.appSecret) {
      this.lastError = "Missing QQBOT_APP_ID or QQBOT_APP_SECRET";
      this.logger.error(this.lastError);
      return;
    }

    this.abort = new AbortController();
    this.client = this.createQQBot({
      appId: this.appId,
      appSecret: this.appSecret,
      logger: this.logger,
      markdownSupport: false,
    });
    this.bindClient(this.client);
    this.running = true;
    this.ready = false;
    this.lastError = undefined;

    this.startPromise = this.client
      .start(this.abort.signal)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        this.logger.error("QQBot start failed", { error: message });
      })
      .finally(() => {
        this.running = false;
        this.ready = false;
      });
  }

  stop(): void {
    try {
      this.abort?.abort();
    } catch {
      // ignore
    }
    try {
      this.client?.stop();
    } catch {
      // ignore
    }
    this.running = false;
    this.ready = false;
    this.startPromise = undefined;
  }

  async waitEvent(timeoutMs = 30_000): Promise<PendingEvent | null> {
    const existing = this.pending.find((e) => e.status === "pending" && !e.seenByWait);
    if (existing) {
      existing.seenByWait = true;
      return existing;
    }
    if (timeoutMs <= 0) {
      return null;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(onEvent);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);
      const onEvent = (event: PendingEvent) => {
        clearTimeout(timer);
        resolve(event);
      };
      this.waiters.push(onEvent);
    });
  }

  async sendText(target: ReplyTarget, text: string): Promise<unknown> {
    const client = this.requireClient();
    if (!text) {
      throw new Error("text is required");
    }
    return client.sendText(target, text);
  }

  async reply(eventId: string, text: string): Promise<unknown> {
    const event = this.pending.find((e) => e.id === eventId);
    if (!event) {
      throw new Error(`Unknown pending event: ${eventId}`);
    }
    if (!event.replyTarget) {
      throw new Error(
        `Event ${eventId} has no replyTarget (kind=${event.kind}). Guild/DM inbound messages cannot be replied via the high-level QQBot facade.`,
      );
    }
    const result = await this.sendText(event.replyTarget, text);
    event.status = "replied";
    return result;
  }

  async sendImage(target: ReplyTarget, source: SendImageSource): Promise<unknown> {
    const client = this.requireClient();
    const resolved = resolveImageSource(source);
    return client.sendImage(target, resolved);
  }

  /** Test helper: inject an inbound SDK message. */
  handleInbound(msg: InboundMessage): PendingEvent {
    const event: PendingEvent = {
      id: `evt_${++this.seq}`,
      kind: msg.kind,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content ?? "",
      messageId: msg.messageId,
      replyTarget: msg.replyTarget,
      receivedAt: new Date().toISOString(),
      status: "pending",
    };
    this.pending.push(event);
    while (this.pending.length > MAX_PENDING) {
      this.pending.shift();
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      event.seenByWait = true;
      waiter(event);
    }
    return event;
  }

  private bindClient(client: QQBotClient): void {
    client.on("ready", () => {
      this.ready = true;
      this.lastError = undefined;
      this.logger.info("QQBot ready");
    });
    client.on("resumed", () => {
      this.ready = true;
      this.logger.info("QQBot resumed");
    });
    client.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.logger.error("QQBot error", { error: message });
    });
    // Queue only. Never auto-reply / echo.
    client.on("message", (_ctx: unknown, msg: unknown) => {
      this.handleInbound(normalizeInbound(msg));
    });
  }

  private requireClient(): QQBotClient {
    if (!this.client) {
      throw new Error(
        "QQ Bot is not started. Set QQBOT_APP_ID and QQBOT_APP_SECRET, then restart the MCP server.",
      );
    }
    return this.client;
  }
}

function normalizeInbound(raw: unknown): InboundMessage {
  const msg = (raw ?? {}) as Record<string, unknown>;
  const reply = msg.replyTarget as ReplyTarget | undefined;
  return {
    kind: String(msg.kind ?? "unknown"),
    senderId: String(msg.senderId ?? ""),
    senderName: typeof msg.senderName === "string" ? msg.senderName : undefined,
    content: String(msg.content ?? ""),
    messageId: String(msg.messageId ?? ""),
    replyTarget:
      reply && (reply.scope === "c2c" || reply.scope === "group") && reply.targetId
        ? {
            scope: reply.scope,
            targetId: reply.targetId,
            msgId: reply.msgId,
          }
        : undefined,
  };
}

export { silentLogger } from "./types.js";
