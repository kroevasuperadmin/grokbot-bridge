import { createHash, timingSafeEqual } from "crypto";

export const CONTEXT_FILES = [
  "CLAUDE.md",
  "STARTUP_HIERARCHY.md",
  "OPEN_ITEMS.md",
  "HANDOFF_2OCT.md",
  "RESUME_NOW.md",
  "MEMORY.md",
  "NO_AI_SLOP.md",
] as const;

export type ContextName = (typeof CONTEXT_FILES)[number];

const COOKIE = "ctx";

function pageKey(): string {
  return process.env.CONTEXT_PAGE_KEY ?? "";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function keyConfigured(): boolean {
  return pageKey().length > 0;
}

export function keyMatches(given: string): boolean {
  const want = pageKey();
  if (!want || !given) return false;
  const a = digest(given);
  const b = digest(want);
  return timingSafeEqual(a, b);
}

function sign(exp: string): string {
  return createHash("sha256").update(`${pageKey()}|${exp}`).digest("hex");
}

export function sessionCookie(exp: number): string {
  const sig = sign(String(exp));
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=${exp}.${sig}; HttpOnly; SameSite=Strict; Path=/context; Max-Age=43200${secure}`;
}

export function hasSession(req: Request): boolean {
  if (!keyConfigured()) return false;
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\s*)ctx=(\d+)\.([a-f0-9]+)/);
  if (!match) return false;
  const exp = Number(match[1]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const got = match[2];
  const want = sign(match[1]);
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function isContextName(name: string, indexedNames: readonly string[] = []): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) return false;
  return (CONTEXT_FILES as readonly string[]).includes(name) || name === "NOTES_FROM_ASSISTANT.md" || indexedNames.includes(name);
}

export function contextListingFiles(indexedNames: readonly string[]): string[] {
  return [...new Set([...CONTEXT_FILES, ...indexedNames.filter((name) => isContextName(name, indexedNames)), "NOTES_FROM_ASSISTANT.md"])];
}
