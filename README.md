# grok-bot-qqbot-plugin

Cursor / Grok Bot plugin that exposes a QQ Bot MCP server.

Protocol layer is only @tencent-connect/qqbot-nodejs. No raw api.bot.qq.com, and no qq-botpy / NapCat / OneBot.

## Requirements

- Node.js >= 20
- A QQ Bot created at https://q.qq.com (AppID + AppSecret)

## Install

From this GitHub repository (joezjm/grok-bot-qqbot-plugin):

1. Obtain the source from GitHub.
2. Install Node dependencies and compile TypeScript to dist/server.js (see Scripts).

Copy .env.example and fill in credentials (never commit .env):

    QQBOT_APP_ID=
    QQBOT_APP_SECRET=

Create the bot at https://q.qq.com. This plugin reads those variables and passes appId/appSecret into the QQBot constructor. The SDK itself never reads process.env.

### Cursor plugin

- .cursor-plugin/plugin.json — name qqbot, display name QQ Bot
- mcp.json — launches node dist/server.js with QQBOT_APP_ID / QQBOT_APP_SECRET
- skills/qqbot/SKILL.md

Install the GitHub repo as a Cursor plugin, then set the two variables under Plugins, Configure. Compile first so dist/server.js exists.

Standalone MCP: command node, args path-to-dist/server.js, env QQBOT_APP_ID and QQBOT_APP_SECRET.

## Scripts

- build: tsc to dist/
- start: node dist/server.js (MCP stdio)
- test: node:test with QQBot mocked (no network)

package.json bin is qqbot-mcp pointing at dist/server.js.

## MCP tools

Inbound QQ messages are queued in memory. No auto-echo — the agent must reply explicitly.

- qqbot_status: connection / config / pending count
- qqbot_send_text: QQBot.sendText(target, text). target may be a ReplyTarget or flattened scope, targetId, optional msgId
- qqbot_reply: reply to a pending event id using its stored replyTarget
- qqbot_list_pending: list queued inbound events
- qqbot_wait_event: wait for bot.on(message); does not auto-reply
- qqbot_send_image: QQBot.sendImage(target, url or localPath)

### ReplyTarget

scope is c2c or group; targetId is the openid; msgId is optional.

- Passive reply: include msgId from the inbound event.
- Proactive send: omit msgId (platform quota limited).
- guild / dm inbound messages have no replyTarget; qqbot_reply will error.

SDK start() blocks until stop/abort. The MCP server starts the bot in the background with AbortController and does not await start() during the stdio handshake. SIGINT, SIGTERM, and stdin close call abort plus bot.stop().

## Caveats

- OpenID is per AppID, not a QQ number. User / group ids from another bot app will not work.
- Group @mention: in groups the bot typically only receives messages that @mention it.
- Proactive quota: sending without msgId counts against QQ proactive-message quota. Prefer qqbot_reply after qqbot_wait_event.
- markdownSupport is always false. Enabling markdown without platform permission returns 40034090 / render errors.
- Credentials live in env / Cursor plugin variables only. Do not commit .env.

## Layout

- src/bot.ts — QQBot wrapper, in-memory queue, AbortController lifecycle
- src/server.ts — MCP stdio server
- src/types.ts — ReplyTarget / pending event types
- tests/ — node:test with a mocked QQBot (no network)
- mcp.json — Cursor MCP launch config
- skills/qqbot/ — Agent skill

## License

MIT
