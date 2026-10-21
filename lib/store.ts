import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BridgeMessage, Direction } from "./types";

// Messages live in the Rizqey Supabase table public.bridge_messages (25 Sep 2026). The old Vercel Blob store was
// suspended by Vercel ("This store has been suspended"), most likely from the doorbells checking it every few
// seconds; a database table has no per-read allowance to run out. Row level security is on with no policies, so
// only the service key can touch it. The local file is only for running the bridge on the laptop.
const MAX_CONTENT = 100_000;
const MAX_LOCAL = 500;
const LOCAL_PATH = path.join(process.cwd(), "data", "messages.json");
const COLS = "id,direction,content,bot_name,created_at,read_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListFilter = {
  direction?: Direction;
  bot_name?: string;
  unread?: boolean;
  limit?: number;
};

function db(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function rest<T>(query: string, init: RequestInit = {}): Promise<T> {
  const d = db()!;
  const res = await fetch(`${d.url}/rest/v1/${query}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: d.key,
      authorization: `Bearer ${d.key}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
  });
  if (!res.ok) throw new Error(`bridge_messages ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** PostgREST filters for one inbox. Bot names match without caring about capitals, like before. */
function where(filter: { direction?: Direction; bot_name?: string; unread?: boolean }): string {
  const parts: string[] = [];
  if (filter.direction) parts.push(`direction=eq.${filter.direction}`);
  if (filter.bot_name) {
    const exact = filter.bot_name.trim().replace(/[\\%_*]/g, (c) => `\\${c}`);
    parts.push(`bot_name=ilike.${encodeURIComponent(exact)}`);
  }
  if (filter.unread) parts.push("read_at=is.null");
  return parts.join("&");
}

function normalizeBot(name: string): string {
  const trimmed = name.trim().slice(0, 64);
  return trimmed || "unknown";
}

function clampContent(content: string): string {
  return content.length <= MAX_CONTENT ? content : content.slice(0, MAX_CONTENT);
}

async function loadLocal(): Promise<BridgeMessage[]> {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveLocal(messages: BridgeMessage[]): Promise<void> {
  await mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await writeFile(LOCAL_PATH, JSON.stringify(messages.slice(-MAX_LOCAL), null, 2), "utf8");
}

export async function addMessage(input: {
  direction: Direction;
  content: string;
  bot_name: string;
}): Promise<BridgeMessage> {
  const row = { direction: input.direction, content: clampContent(input.content), bot_name: normalizeBot(input.bot_name) };
  if (db()) return (await rest<BridgeMessage[]>(`bridge_messages?select=${COLS}`, { method: "POST", body: JSON.stringify([row]) }))[0];
  const msg: BridgeMessage = { id: randomUUID(), ...row, created_at: new Date().toISOString(), read_at: null };
  const all = await loadLocal();
  all.push(msg);
  await saveLocal(all);
  return msg;
}

export async function addAssistantNote(content: string): Promise<BridgeMessage> {
  return addMessage({ direction: "from_grokbot", content, bot_name: "Assistant Notes" });
}

export async function listAssistantNotes(): Promise<BridgeMessage[]> {
  if (!db()) {
    return (await loadLocal())
      .filter((message) => message.direction === "from_grokbot" && message.bot_name === "Assistant Notes")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const notes: BridgeMessage[] = [];
  for (let offset = 0; ; offset += 200) {
    const batch = await rest<BridgeMessage[]>(
      `bridge_messages?select=${COLS}&direction=eq.from_grokbot&bot_name=eq.${encodeURIComponent("Assistant Notes")}&order=created_at.asc&limit=200&offset=${offset}`,
    );
    notes.push(...batch);
    if (batch.length < 200) return notes;
  }
}

/** Oldest first, the last `limit` matching messages (same order the doorbells and bots always got). */
export async function listMessages(filter: ListFilter = {}): Promise<BridgeMessage[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  if (db()) {
    const w = where(filter);
    const rows = await rest<BridgeMessage[]>(`bridge_messages?select=${COLS}${w ? `&${w}` : ""}&order=created_at.desc&limit=${limit}`);
    return rows.reverse();
  }
  let rows = await loadLocal();
  if (filter.direction) rows = rows.filter((m) => m.direction === filter.direction);
  if (filter.bot_name) rows = rows.filter((m) => m.bot_name.toLowerCase() === filter.bot_name!.trim().toLowerCase());
  if (filter.unread) rows = rows.filter((m) => !m.read_at);
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rows.slice(-limit);
}

export async function markRead(ids: string[]): Promise<BridgeMessage[]> {
  const good = ids.filter((id) => UUID.test(id));
  if (good.length === 0) return [];
  const now = new Date().toISOString();
  if (db()) {
    return rest<BridgeMessage[]>(`bridge_messages?select=${COLS}&id=in.(${good.join(",")})&read_at=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ read_at: now }),
    });
  }
  const want = new Set(good);
  const all = await loadLocal();
  const updated = all.filter((m) => want.has(m.id) && !m.read_at);
  updated.forEach((m) => (m.read_at = now));
  await saveLocal(all);
  return updated;
}

export async function markReadMatching(filter: { direction?: Direction; bot_name?: string }): Promise<BridgeMessage[]> {
  const now = new Date().toISOString();
  if (db()) {
    return rest<BridgeMessage[]>(`bridge_messages?select=${COLS}&${where({ ...filter, unread: true })}`, {
      method: "PATCH",
      body: JSON.stringify({ read_at: now }),
    });
  }
  const all = await loadLocal();
  const updated = all.filter(
    (m) =>
      !m.read_at &&
      (!filter.direction || m.direction === filter.direction) &&
      (!filter.bot_name || m.bot_name.toLowerCase() === filter.bot_name.trim().toLowerCase()),
  );
  updated.forEach((m) => (m.read_at = now));
  await saveLocal(all);
  return updated;
}
