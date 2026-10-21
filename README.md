# grokbot-bridge

Public MCP + REST mailbox so Grok Bot and Claude Code can pass tasks/findings without copy-paste.

Grok Bot has no chat/messaging API and cannot reach localhost MCP. This service is the public endpoint both sides share.

Live: `https://grokbot-bridge.vercel.app`

| Surface | Who | Path |
|---|---|---|
| MCP Streamable HTTP | Grok Bot | `/mcp` |
| REST | Claude Code | `/api/messages` |
| Health | anyone | `/api/health` |

Auth on MCP and REST: `Authorization: Bearer $BRIDGE_TOKEN` (also accepts `x-bridge-token`). Token lives in `.env.local` and Vercel env. Do not commit it.

Scoped auth can be enabled with `BRIDGE_TOKENS`, a JSON object mapping client labels to `{ "token": "...", "scopes": [...] }`. Supported scopes are `messages:read`, `messages:send`, `messages:reply`, `messages:mark_read`, `jobs:claim`, and `sync:run`. REST message reads, sends, replies, read marking, job claims, and sync each require their matching scope. MCP applies the same scopes per tool and message direction. Unknown MCP tools/actions are denied.

When `BRIDGE_TOKENS` is present, it takes precedence over `BRIDGE_TOKEN`; an empty or invalid map denies all access and never falls back. When it is absent, `BRIDGE_TOKEN` keeps legacy behavior with all scopes. For a safe rollout, test a scoped map in Development first, provision separate least-privilege tokens to each client, then set the Production map. Once Production has the map, the old shared token stops working there. Do not put token values in source control or logs.

For local clients, keep `BRIDGE_TOKEN` as the shared room identity (`messages:read`, `messages:send`, `messages:reply`, `jobs:claim`). The CLI may override it with `BRIDGE_TOKEN_CLI`; the watcher may override it with `BRIDGE_TOKEN_WATCHER`. Operator-only CLI commands (`read` and `wake`) use `BRIDGE_ADMIN_TOKEN` once scoped auth is enabled. Roll out only after assigning those scopes in `BRIDGE_TOKENS`; do not replace or broaden the shared-room token to make operator commands work.

Shared team context: `/context`. The one-key login uses `CONTEXT_PAGE_KEY`; it is separate from the Bridge API token. Keep the listed files and their credentials private to authenticated team members. `context/` is gitignored. Before a build, `node scripts/redact-context.mjs` copies the five shared files and every Markdown file linked from `MEMORY.md` in the approved memory folder, then writes the allowed-name index. `/context/notes` accepts authenticated, same-origin notes and appends them to the existing private Bridge message store. `/context/view?name=NOTES_FROM_ASSISTANT.md` shows the log. Notes can be added, not edited or removed.

## Message shape

- `id` uuid
- `direction` `to_grokbot` (Claude → bots) or `from_grokbot` (bots → Claude)
- `content` text
- `bot_name` Herald / Doomscrolla / Doomscrollr / …
- `created_at` ISO
- `read_at` ISO or null

Store: private Vercel Blob (`messages.json`). Locally, without a blob token, `data/messages.json`.

## Grok Bot (manual, app-only)

There is no settings form and no API to add a server. Cursor staff: tell the bot in chat. Official docs (`docs.x.ai/grok-bot`) only cover Marketplace plugins; custom remotes are chat-driven (`AddMcpServer`). `grok mcp add` is Grok Build, not Grok Bot.

1. Open Grok Bot (desktop or phone).
2. Open any Bot (Herald is fine; the connector is account-wide).
3. Send this, with the real token from `.env.local`:

```
Add a custom MCP server called claude-bridge at https://grokbot-bridge.vercel.app/mcp

This is a custom remote Streamable HTTP server, not a marketplace plugin.
Auth header: Authorization
Value: Bearer <BRIDGE_TOKEN from .env.local>

Do not install a catalog plugin. Do not use localhost.
```

4. Confirm the URL. Click **Add it**.
5. There is no OAuth card (shared secret, not OAuth). The bot should report 4 tools: `post_message`, `get_pending_tasks`, `list_messages`, `mark_read`.
6. Type `@` and attach **claude-bridge** on tasks/routines that should use it.
7. Check **Marketplace → Your plugins** (or Plugins → Yours) that `claude-bridge` is listed and enabled.

Give each scheduled bot a standing instruction:

```
On every routine run: call get_pending_tasks with bot_name set to your name.
Do those tasks. Then post_message with direction=from_grokbot, your bot_name, and the findings.
Then mark_read on the task ids you finished.
```

## Claude Code

From `C:\Users\diony\dev\grokbot-bridge` (`.env.local` already has token + URL):

```
node scripts/bridge.mjs send --to grokbot --bot Doomscrollr -- "your task"
node scripts/bridge.mjs pending --bot Doomscrollr
node scripts/bridge.mjs inbox --unread
node scripts/bridge.mjs read <id>
```

Curl:

```
curl -H "Authorization: Bearer $BRIDGE_TOKEN" https://grokbot-bridge.vercel.app/api/messages?unread=1

curl -H "Authorization: Bearer $BRIDGE_TOKEN" -H "Content-Type: application/json" ^
  -d "{\"direction\":\"to_grokbot\",\"bot_name\":\"Herald\",\"content\":\"task\"}" ^
  https://grokbot-bridge.vercel.app/api/messages
```

## Local

```
npm install
npm run dev
node scripts/smoke.mjs
```

Dev server: `http://127.0.0.1:3210`. Grok Bot cannot use that URL.

## Job board link (24 Sep 2026)

The bridge reads Faris's job board (Rizqey Supabase) itself. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

- `get_pending_tasks(bot_name)` also returns the bot's approved (`go`) board jobs as text starting `JOB #<n>: <title>`. Each is flipped to `doing` and gets a pickup note the moment it goes out, so it is never handed out twice. A job is a bot's when owner is `grokbot`, owner is the bot, or a step line starts with `[<bot>]`.
- `post_message(direction=from_grokbot)` whose first line has `JOB #<n>` lands on that job as a note. `DONE` or `FINISHED` in that first line sets the job to `ready` with the reply as output. Never `done`. Unknown number: message kept, clear error, no throw.
- Board notes are written as `who=grokbot` with `[<bot>]` at the start of the body. The table's own check only allows faris / claude / cursor / grokbot.
- Sifo-Dyas is refused. Known bots: wisma, herald, strata, dossair, sonar, doomscrolla, doomscrollr, vigil, tiba.
- `GET /api/sync` (Bearer `BRIDGE_TOKEN`): counts waiting bot jobs and pokes Wisma if `WISMA_WAKE_URL` + `WISMA_WAKE_KEY` are set (they are not yet). Vercel cron runs it daily (Hobby plan limit). `node scripts/bridge.mjs wake` calls it by hand; `send --to grokbot` calls it after posting.
