import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  BotController,
  resolveImageSource,
  resolveReplyTarget,
} from "../src/bot.js";
import type { QQBotClient, QQBotOptions, ReplyTarget } from "../src/types.js";
import { silentLogger } from "../src/types.js";

class MockQQBot extends EventEmitter implements QQBotClient {
  readonly options: QQBotOptions;
  started = false;
  stopped = false;
  startCalls = 0;
  sentText: Array<{ target: ReplyTarget; text: string }> = [];
  sentImage: Array<{ target: ReplyTarget; source: unknown }> = [];
  private startResolve?: () => void;

  constructor(options: QQBotOptions) {
    super();
    this.options = options;
  }

  on(event: string, handler: (...args: unknown[]) => unknown): this {
    super.on(event, handler);
    return this;
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.startCalls += 1;
    this.started = true;
    this.emit("ready", {});
    await new Promise<void>((resolve) => {
      this.startResolve = resolve;
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  stop(): void {
    this.stopped = true;
    this.startResolve?.();
  }

  async sendText(target: ReplyTarget, text: string): Promise<unknown> {
    this.sentText.push({ target, text });
    return { id: `text-${this.sentText.length}` };
  }

  async sendImage(
    target: ReplyTarget,
    source: { url: string } | { localPath: string },
  ): Promise<unknown> {
    this.sentImage.push({ target, source });
    return { id: `img-${this.sentImage.length}` };
  }

  emitMessage(msg: unknown): void {
    this.emit("message", {}, msg);
  }
}

function createHarness(env?: { appId?: string; appSecret?: string }) {
  let mock: MockQQBot | undefined;
  const bot = new BotController({
    appId: env?.appId ?? "app-12345678",
    appSecret: env?.appSecret ?? "secret",
    logger: silentLogger,
    createQQBot: (options) => {
      mock = new MockQQBot(options);
      return mock;
    },
  });
  return {
    bot,
    getMock: () => {
      assert.ok(mock, "QQBot was not constructed");
      return mock;
    },
  };
}

describe("resolveReplyTarget", () => {
  it("accepts a nested ReplyTarget", () => {
    assert.deepEqual(
      resolveReplyTarget({
        target: { scope: "c2c", targetId: "u1", msgId: "m1" },
      }),
      { scope: "c2c", targetId: "u1", msgId: "m1" },
    );
  });

  it("accepts flattened scope/targetId/msgId", () => {
    assert.deepEqual(
      resolveReplyTarget({ scope: "group", targetId: "g1" }),
      { scope: "group", targetId: "g1" },
    );
  });

  it("rejects missing fields", () => {
    assert.throws(() => resolveReplyTarget({}), /scope|targetId/);
  });
});

describe("resolveImageSource", () => {
  it("accepts url xor localPath", () => {
    assert.deepEqual(resolveImageSource({ url: "https://example.com/a.png" }), {
      url: "https://example.com/a.png",
    });
    assert.deepEqual(resolveImageSource({ localPath: "/tmp/a.png" }), {
      localPath: "/tmp/a.png",
    });
  });

  it("rejects both or neither", () => {
    assert.throws(
      () => resolveImageSource({ url: "https://x", localPath: "/tmp/a.png" }),
      /exactly one/,
    );
    assert.throws(() => resolveImageSource({}), /url or localPath/);
  });
});

describe("BotController", () => {
  it("reads credentials from env and passes them to QQBot (SDK never reads process.env)", () => {
    const previousId = process.env.QQBOT_APP_ID;
    const previousSecret = process.env.QQBOT_APP_SECRET;
    process.env.QQBOT_APP_ID = "env-app-id-9999";
    process.env.QQBOT_APP_SECRET = "env-secret";
    try {
      let seen: QQBotOptions | undefined;
      const bot = BotController.fromEnv(process.env, {
        logger: silentLogger,
        createQQBot: (options) => {
          seen = options;
          return new MockQQBot(options);
        },
      });
      bot.startBackground();
      assert.equal(seen?.appId, "env-app-id-9999");
      assert.equal(seen?.appSecret, "env-secret");
      assert.equal(seen?.markdownSupport, false);
      bot.stop();
    } finally {
      if (previousId === undefined) delete process.env.QQBOT_APP_ID;
      else process.env.QQBOT_APP_ID = previousId;
      if (previousSecret === undefined) delete process.env.QQBOT_APP_SECRET;
      else process.env.QQBOT_APP_SECRET = previousSecret;
    }
  });

  it("startBackground does not await SDK start() (handshake-safe)", async () => {
    const { bot, getMock } = createHarness();
    const startedAt = Date.now();
    bot.startBackground();
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 50, `startBackground blocked for ${elapsed}ms`);
    const mock = getMock();
    await new Promise((r) => setImmediate(r));
    assert.equal(mock.startCalls, 1);
    assert.equal(bot.getStatus().running, true);
    assert.equal(bot.getStatus().ready, true);
    assert.equal(mock.stopped, false);
    bot.stop();
    assert.equal(mock.stopped, true);
  });

  it("queues inbound messages and never auto-replies", async () => {
    const { bot, getMock } = createHarness();
    bot.startBackground();
    const mock = getMock();
    mock.emitMessage({
      kind: "c2c",
      senderId: "u1",
      content: "hello",
      messageId: "m1",
      replyTarget: { scope: "c2c", targetId: "u1", msgId: "m1" },
    });
    const pending = bot.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].content, "hello");
    assert.equal(mock.sentText.length, 0);
    bot.stop();
  });

  it("wait_event returns queued message without sending", async () => {
    const { bot, getMock } = createHarness();
    bot.startBackground();
    const mock = getMock();
    mock.emitMessage({
      kind: "group",
      senderId: "u2",
      content: "ping",
      messageId: "m2",
      replyTarget: { scope: "group", targetId: "g1", msgId: "m2" },
    });
    const event = await bot.waitEvent(10);
    assert.ok(event);
    assert.equal(event?.content, "ping");
    assert.equal(mock.sentText.length, 0);
    bot.stop();
  });

  it("wait_event waits for a later message then times out", async () => {
    const { bot, getMock } = createHarness();
    bot.startBackground();
    const mock = getMock();
    const waiting = bot.waitEvent(200);
    setTimeout(() => {
      mock.emitMessage({
        kind: "c2c",
        senderId: "u3",
        content: "later",
        messageId: "m3",
        replyTarget: { scope: "c2c", targetId: "u3", msgId: "m3" },
      });
    }, 20);
    const event = await waiting;
    assert.equal(event?.content, "later");
    const timedOut = await bot.waitEvent(15);
    assert.equal(timedOut, null);
    bot.stop();
  });

  it("qqbot_reply uses the stored replyTarget", async () => {
    const { bot, getMock } = createHarness();
    bot.startBackground();
    const mock = getMock();
    mock.emitMessage({
      kind: "c2c",
      senderId: "u1",
      content: "hi",
      messageId: "mid-9",
      replyTarget: { scope: "c2c", targetId: "openid-u1", msgId: "mid-9" },
    });
    const [event] = bot.listPending();
    await bot.reply(event.id, "pong");
    assert.equal(mock.sentText.length, 1);
    assert.deepEqual(mock.sentText[0].target, {
      scope: "c2c",
      targetId: "openid-u1",
      msgId: "mid-9",
    });
    assert.equal(mock.sentText[0].text, "pong");
    assert.equal(bot.listPending().length, 0);
    bot.stop();
  });

  it("cannot reply to guild/dm messages without replyTarget", async () => {
    const { bot, getMock } = createHarness();
    bot.startBackground();
    const mock = getMock();
    mock.emitMessage({
      kind: "guild",
      senderId: "u1",
      content: "channel hi",
      messageId: "g1",
    });
    const [event] = bot.listPending();
    await assert.rejects(() => bot.reply(event.id, "nope"), /no replyTarget/);
    assert.equal(mock.sentText.length, 0);
    bot.stop();
  });

  it("sendText and sendImage forward to the SDK", async () => {
    const { bot, getMock } = createHarness();
    bot.startBackground();
    const mock = getMock();
    const target: ReplyTarget = { scope: "group", targetId: "g9", msgId: "m9" };
    await bot.sendText(target, "hello");
    await bot.sendImage(target, { url: "https://example.com/cat.png" });
    assert.equal(mock.sentText[0].text, "hello");
    assert.deepEqual(mock.sentImage[0].source, {
      url: "https://example.com/cat.png",
    });
    bot.stop();
  });

  it("status reports unconfigured when env vars are missing", () => {
    const bot = new BotController({ logger: silentLogger });
    bot.startBackground();
    const status = bot.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.running, false);
    assert.match(status.lastError ?? "", /QQBOT_APP_ID/);
  });
});
