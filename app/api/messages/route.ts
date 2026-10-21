import { hasTokenConfigured, isAuthorized, messageWriteScope, misconfigured, REST_SCOPES, unauthorized, type BridgeScope } from "@/lib/auth";
import { json } from "@/lib/json";
import { addMessage, listMessages } from "@/lib/store";
import { isDirection } from "@/lib/types";
import { noteFromBot, wake } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function gate(req: Request, required: readonly BridgeScope[]): Response | null {
  if (!hasTokenConfigured()) return misconfigured();
  if (!isAuthorized(req, required)) return unauthorized();
  return null;
}

export async function GET(req: Request) {
  const denied = gate(req, REST_SCOPES.messagesGet);
  if (denied) return denied;

  const url = new URL(req.url);
  const direction = url.searchParams.get("direction");
  const bot_name = url.searchParams.get("bot_name") ?? undefined;
  const unread = url.searchParams.get("unread");
  const limitRaw = url.searchParams.get("limit");
  if (direction && !isDirection(direction)) {
    return json({ error: "direction must be to_grokbot or from_grokbot" }, 400);
  }
  const limit = limitRaw ? Number(limitRaw) : 50;
  const messages = await listMessages({
    direction: direction && isDirection(direction) ? direction : undefined,
    bot_name,
    unread: unread === "1" || unread === "true",
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return json({ count: messages.length, messages });
}

export async function POST(req: Request) {
  const denied = gate(req, []);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, 400);
  const rec = body as Record<string, unknown>;
  const content = typeof rec.content === "string" ? rec.content : "";
  const bot_name = typeof rec.bot_name === "string" ? rec.bot_name : "";
  const direction = rec.direction;
  if (!content.trim()) return json({ error: "content is required" }, 400);
  if (!bot_name.trim()) return json({ error: "bot_name is required" }, 400);
  if (!isDirection(direction)) {
    return json({ error: "direction must be to_grokbot or from_grokbot" }, 400);
  }
  const scope = messageWriteScope(direction);
  const scopeDenied = scope ? gate(req, [scope]) : unauthorized();
  if (scopeDenied) return scopeDenied;
  const message = await addMessage({ content, bot_name, direction });
  // Same rule as the MCP door: a bot reply whose first line says "JOB #n" lands on the board.
  const board = direction === "from_grokbot" ? await noteFromBot(bot_name, content) : null;
  // Same as the MCP door: every message for Grok Bot wakes it now, not on its next scheduled check.
  const woke = direction === "to_grokbot" ? await wake(`new bridge message for ${bot_name}: ${content.slice(0, 500)}`) : undefined;
  return json({ ok: true, message, ...(board ? { board } : {}), ...(woke ? { woke } : {}) }, 201);
}
