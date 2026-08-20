import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { BotController } from "../src/bot.js";
import { createMcpServer } from "../src/server.js";
import type { QQBotClient, QQBotOptions, ReplyTarget } from "../src/types.js";
import { silentLogger } from "../src/types.js";

class MockQQBot extends EventEmitter implements QQBotClient {
  constructor(readonly options: QQBotOptions) {
    super();
  }
  on(event: string, handler: (...args: unknown[]) => unknown): this {
    super.on(event, handler);
    return this;
  }
  async start(): Promise<void> {
    this.emit("ready", {});
    await new Promise(() => {});
  }
  stop(): void {}
  async sendText(target: ReplyTarget, text: string) {
    return { id: "t", target, text };
  }
  async sendImage(target: ReplyTarget, source: unknown) {
    return { id: "i", target, source };
  }
}

describe("createMcpServer", () => {
  it("registers the six QQ Bot tools", () => {
    const bot = new BotController({
      appId: "a",
      appSecret: "s",
      logger: silentLogger,
      createQQBot: (options) => new MockQQBot(options),
    });
    const server = createMcpServer(bot);
    const maybeMap = (
      server as unknown as { _registeredTools?: Record<string, unknown> }
    )._registeredTools;
    const names = Object.keys(maybeMap ?? {});
    for (const name of [
      "qqbot_status",
      "qqbot_send_text",
      "qqbot_reply",
      "qqbot_list_pending",
      "qqbot_wait_event",
      "qqbot_send_image",
    ]) {
      assert.ok(names.includes(name), `missing tool ${name}, have ${names.join(",")}`);
    }
  });
});
