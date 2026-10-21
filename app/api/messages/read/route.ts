import { hasTokenConfigured, isAuthorized, misconfigured, REST_SCOPES, unauthorized } from "@/lib/auth";
import { json } from "@/lib/json";
import { markRead, markReadMatching } from "@/lib/store";
import { isDirection } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(req: Request) {
  if (!hasTokenConfigured()) return misconfigured();
  if (!isAuthorized(req, REST_SCOPES.messagesReadPost)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, 400);
  const rec = body as Record<string, unknown>;
  const direction = rec.direction;
  if (direction !== undefined && !isDirection(direction)) {
    return json({ error: "direction must be to_grokbot or from_grokbot" }, 400);
  }

  if (rec.all === true) {
    const updated = await markReadMatching({
      bot_name: typeof rec.bot_name === "string" ? rec.bot_name : undefined,
      direction: isDirection(direction) ? direction : undefined,
    });
    return json({ ok: true, marked: updated.length, messages: updated });
  }

  const ids: string[] = [];
  if (typeof rec.id === "string") ids.push(rec.id);
  if (Array.isArray(rec.ids)) {
    for (const value of rec.ids) if (typeof value === "string") ids.push(value);
  }
  if (ids.length === 0) return json({ error: "pass id, ids, or all=true" }, 400);
  const updated = await markRead(ids);
  return json({ ok: true, marked: updated.length, messages: updated });
}
