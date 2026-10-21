import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { hasTokenConfigured, isAuthorized, mcpRequiredScopes, misconfigured, unauthorized, type BridgeScope } from "@/lib/auth";
import { textResult } from "@/lib/json";
import { addMessage, listMessages, markRead, markReadMatching } from "@/lib/store";
import { BOTS, boardConfigured, noteFromBot, refusal, takeJobs, wake } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "post_message",
      {
        title: "Post message",
        description:
          "Write onto the shared Claude Code ↔ Grok Bot bridge. Grok Bots reporting work back MUST set direction=from_grokbot and bot_name to their own name. If the reply is about a board job, start the FIRST LINE with \"JOB #<number>\" and it lands on that job on Faris's board; put DONE in that first line when the job is finished and it goes back to Faris as ready. Include enough context that Claude Code can act without the original chat.",
        inputSchema: z.object({
          content: z.string().min(1).describe("Message body"),
          bot_name: z.string().min(1).describe("Bot name, e.g. Herald, Doomscrolla, Doomscrollr"),
          direction: z
            .enum(["to_grokbot", "from_grokbot"])
            .optional()
            .describe("Defaults to from_grokbot"),
        }),
      },
      async ({ content, bot_name, direction }) => {
        const dir = direction ?? "from_grokbot";
        const msg = await addMessage({ content, bot_name, direction: dir });
        // A bot's reply about a job also lands on the board. Claude's task to a bot pokes Wisma.
        const board = dir === "from_grokbot" ? await noteFromBot(bot_name, content) : null;
        const woke = dir === "to_grokbot" ? await wake(`new bridge message for ${bot_name}`) : undefined;
        return textResult({ ok: true, message: msg, ...(board ? { board } : {}), ...(woke ? { wake: woke } : {}) });
      },
    );

    server.registerTool(
      "get_pending_tasks",
      {
        title: "Get pending tasks",
        description:
          "Read unread tasks Claude Code posted for Grok Bot (direction=to_grokbot) AND your approved jobs from Faris's board. Pass bot_name as your own name (" +
          BOTS.join(", ") +
          "). Board jobs come as text starting \"JOB #<number>: <title>\"; each is handed out once and is marked as being worked on the moment you receive it. Reply on a job with post_message, first line \"JOB #<number>\". After finishing a bridge message, call mark_read so it is not delivered again.",
        inputSchema: z.object({
          bot_name: z
            .string()
            .optional()
            .describe("Your bot name. Omit to see tasks for every bot."),
          limit: z.number().int().min(1).max(200).optional(),
        }),
      },
      async ({ bot_name, limit }) => {
        const no = bot_name ? refusal(bot_name) : null;
        if (no) return textResult({ count: 0, refused: no, messages: [], jobs: [] });
        const messages = await listMessages({
          direction: "to_grokbot",
          bot_name,
          unread: true,
          limit: limit ?? 50,
        });
        // Board jobs need a name to hand them to. Without one, only bridge messages come back.
        let jobs: { job: number; text: string }[] = [];
        let board = bot_name ? "ok" : "no bot_name given, so no board jobs";
        if (bot_name) {
          if (!boardConfigured()) board = "board not set up on the bridge";
          else {
            try {
              const took = await takeJobs(bot_name.trim().toLowerCase());
              jobs = took.jobs;
              if (took.warnings.length) board = took.warnings.join("; ");
            } catch (e) {
              board = `board read failed: ${(e as Error).message}`;
            }
          }
        }
        return textResult({ count: messages.length + jobs.length, messages, jobs, board });
      },
    );

    server.registerTool(
      "list_messages",
      {
        title: "List messages",
        description: "List recent bridge messages. Use unread_only=true to skip already-consumed ones.",
        inputSchema: z.object({
          direction: z.enum(["to_grokbot", "from_grokbot"]).optional(),
          bot_name: z.string().optional(),
          unread_only: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        }),
      },
      async ({ direction, bot_name, unread_only, limit }) => {
        const messages = await listMessages({
          direction,
          bot_name,
          unread: unread_only,
          limit: limit ?? 50,
        });
        return textResult({ count: messages.length, messages });
      },
    );

    server.registerTool(
      "mark_read",
      {
        title: "Mark read",
        description:
          "Mark bridge messages as consumed. Pass id for one message, ids for several, or all=true (optionally scoped by bot_name / direction).",
        inputSchema: z.object({
          id: z.string().optional(),
          ids: z.array(z.string()).optional(),
          all: z.boolean().optional(),
          bot_name: z.string().optional(),
          direction: z.enum(["to_grokbot", "from_grokbot"]).optional(),
        }),
      },
      async ({ id, ids, all, bot_name, direction }) => {
        if (all) {
          const updated = await markReadMatching({ bot_name, direction });
          return textResult({ ok: true, marked: updated.length, messages: updated });
        }
        const list = [...(ids ?? []), ...(id ? [id] : [])];
        if (list.length === 0) {
          return textResult({ ok: false, error: "pass id, ids, or all=true" });
        }
        const updated = await markRead(list);
        return textResult({ ok: true, marked: updated.length, messages: updated });
      },
    );
  },
  {
    serverInfo: {
      name: "grokbot-bridge",
      version: "1.0.0",
    },
  },
);

async function guarded(req: Request): Promise<Response> {
  if (!hasTokenConfigured()) return misconfigured();
  let required: readonly BridgeScope[] = [];
  if (req.method === "POST") {
    let body: unknown;
    try {
      body = await req.clone().json();
    } catch {
      return unauthorized();
    }
    const scopes = mcpRequiredScopes(body);
    if (scopes === null) return unauthorized();
    required = scopes;
  }
  if (!isAuthorized(req, required)) return unauthorized();
  return mcpHandler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
