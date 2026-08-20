---
name: qqbot
description: Talk to QQ users and groups through the qqbot MCP tools backed by @tencent-connect/qqbot-nodejs. Use when the user wants to send or reply to QQ Bot messages, wait for inbound QQ events, or check QQ Bot status.
---

# QQ Bot

Use the `qqbot` MCP server. Protocol layer is **only** `@tencent-connect/qqbot-nodejs`. Do not call `api.bot.qq.com` yourself, and do not use qq-botpy / NapCat / OneBot.

## Tools

| Tool | When |
| --- | --- |
| `qqbot_status` | Check credentials, connection, pending count |
| `qqbot_wait_event` | Block until an inbound C2C/group message is queued |
| `qqbot_list_pending` | Inspect the in-memory inbound queue |
| `qqbot_reply` | Passive reply using the stored `replyTarget` (includes `msgId`) |
| `qqbot_send_text` | Send text to a `ReplyTarget` (nested or flattened `scope` + `targetId` + optional `msgId`) |
| `qqbot_send_image` | Send an image (`url` **xor** `localPath`) |

Inbound messages are **queued only**. Never assume auto-echo. Always `qqbot_reply` or `qqbot_send_text` after reading an event.

## ReplyTarget

```ts
{ scope: "c2c" | "group", targetId: string, msgId?: string }
```

- `c2c` `targetId` is the user **openid** (per AppID, not a QQ number).
- `group` `targetId` is the group openid.
- `msgId` present → passive reply (preferred).
- `msgId` absent → proactive send (platform quota limited).
- `guild` / `dm` inbound events have **no** `replyTarget`; do not call `qqbot_reply` on them.

## Workflow

1. `qqbot_status` — confirm `configured` and `running`.
2. `qqbot_wait_event` (or `qqbot_list_pending`) — read user text. Do **not** auto-reply.
3. Think / gather context, then `qqbot_reply` with the event id.
4. For images, `qqbot_send_image` with the same `replyTarget` (keep `msgId` when possible).

## Caveats

- Group messages usually require an @mention of the bot.
- Keep `markdownSupport` false unless the bot has markdown permission (this plugin always passes `false`).
- Credentials come from `QQBOT_APP_ID` / `QQBOT_APP_SECRET` injected by this plugin; the SDK itself never reads `process.env`.
