#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BotController, resolveReplyTarget } from "./bot.js";
import type { BotController as BotControllerType } from "./bot.js";

const PACKAGE_VERSION = "1.0.0";

const replyTargetShape = {
  scope: z.enum(["c2c", "group"]).describe("c2c private chat or group chat"),
  targetId: z
    .string()
    .describe("c2c: user openid; group: group openid (per-app, not QQ number)"),
  msgId: z
    .string()
    .optional()
    .describe("Inbound message id for a passive reply; omit for proactive send (quota limited)"),
};

function jsonResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return jsonResult({ ok: false, error: message }, true);
}

export function createMcpServer(bot: BotControllerType): McpServer {
  const server = new McpServer({
    name: "qqbot",
    version: PACKAGE_VERSION,
  });

  server.tool(
    "qqbot_status",
    "Return QQ Bot connection status, configuration, and pending inbound event count. Does not send messages.",
    async () => jsonResult({ ok: true, status: bot.getStatus() }),
  );

  server.tool(
    "qqbot_send_text",
    "Send a text message via QQBot.sendText. Pass a ReplyTarget object, or flattened scope/targetId/msgId. Include msgId for a passive reply; omit it for a proactive send (quota limited).",
    {
      text: z.string().describe("Message text to send"),
      target: z.object(replyTargetShape).optional().describe("ReplyTarget { scope, targetId, msgId? }"),
      scope: z.enum(["c2c", "group"]).optional(),
      targetId: z.string().optional(),
      msgId: z.string().optional(),
    },
    async (args) => {
      try {
        const target = resolveReplyTarget(args);
        const result = await bot.sendText(target, args.text);
        return jsonResult({ ok: true, target, result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "qqbot_reply",
    "Reply to a queued inbound event by id. Uses the stored replyTarget from bot.on('message'). Guild/DM events have no replyTarget and cannot be replied this way.",
    {
      eventId: z.string().describe("Pending event id from qqbot_list_pending or qqbot_wait_event"),
      text: z.string().describe("Reply text"),
    },
    async (args) => {
      try {
        const result = await bot.reply(args.eventId, args.text);
        return jsonResult({ ok: true, eventId: args.eventId, result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "qqbot_list_pending",
    "List inbound QQ messages queued in memory from bot.on('message'). The server never auto-replies.",
    {
      limit: z.number().int().positive().max(200).optional().describe("Max events to return (default 50)"),
    },
    async (args) => {
      const events = bot.listPending(args.limit ?? 50);
      return jsonResult({ ok: true, count: events.length, events });
    },
  );

  server.tool(
    "qqbot_wait_event",
    "Wait for the next inbound QQ message (or return one already queued). Does not auto-reply. Times out with event=null.",
    {
      timeoutMs: z
        .number()
        .int()
        .nonnegative()
        .max(120_000)
        .optional()
        .describe("How long to wait in milliseconds (default 30000)"),
    },
    async (args) => {
      const event = await bot.waitEvent(args.timeoutMs ?? 30_000);
      return jsonResult({ ok: true, event });
    },
  );

  server.tool(
    "qqbot_send_image",
    "Send an image with QQBot.sendImage. Provide a ReplyTarget plus exactly one of url (QQ server fetch) or localPath.",
    {
      target: z.object(replyTargetShape).describe("ReplyTarget { scope, targetId, msgId? }"),
      url: z.string().optional().describe("HTTPS URL for QQ to fetch (host must be allowlisted)"),
      localPath: z.string().optional().describe("Absolute local file path"),
    },
    async (args) => {
      try {
        const target = resolveReplyTarget({ target: args.target });
        const result = await bot.sendImage(target, {
          url: args.url,
          localPath: args.localPath,
        });
        return jsonResult({ ok: true, target, result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const bot = BotController.fromEnv();
  // start() blocks until stop/abort — never await it on the MCP handshake.
  bot.startBackground();

  const server = createMcpServer(bot);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    bot.stop();
    try {
      await server.close();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.stdin.on("end", () => {
    void shutdown();
  });
  process.stdin.on("close", () => {
    void shutdown();
  });

  await server.connect(transport);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("server.js") || entry.endsWith("server.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
