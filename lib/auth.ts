import { timingSafeEqual } from "crypto";

export const BRIDGE_SCOPES = [
  "messages:read",
  "messages:send",
  "messages:reply",
  "messages:mark_read",
  "jobs:claim",
  "sync:run",
] as const;

export type BridgeScope = (typeof BRIDGE_SCOPES)[number];

export const REST_SCOPES = {
  messagesGet: ["messages:read"],
  messagesReadPost: ["messages:mark_read"],
  jobsGet: ["jobs:claim"],
  syncGet: ["sync:run"],
} as const satisfies Record<string, readonly BridgeScope[]>;

type Credential = { token: string; scopes: BridgeScope[] };
type AuthConfig = { valid: boolean; scoped: boolean; credentials: Credential[] };

const ALL_SCOPES = [...BRIDGE_SCOPES];

function readConfig(): AuthConfig {
  if (process.env.BRIDGE_TOKENS !== undefined) {
    try {
      const raw: unknown = JSON.parse(process.env.BRIDGE_TOKENS);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
      const entries = Object.entries(raw);
      if (entries.length === 0) throw new Error();
      const credentials: Credential[] = [];
      const seen = new Set<string>();
      for (const [label, value] of entries) {
        if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(label) || !value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        const rec = value as Record<string, unknown>;
        if (Object.keys(rec).some((key) => key !== "token" && key !== "scopes")) throw new Error();
        if (typeof rec.token !== "string" || rec.token.length < 32 || !Array.isArray(rec.scopes) || rec.scopes.length === 0) throw new Error();
        if (seen.has(rec.token)) throw new Error();
        seen.add(rec.token);
        const scopes: BridgeScope[] = [];
        for (const scope of rec.scopes) {
          if (typeof scope !== "string" || !(BRIDGE_SCOPES as readonly string[]).includes(scope) || scopes.includes(scope as BridgeScope)) throw new Error();
          scopes.push(scope as BridgeScope);
        }
        credentials.push({ token: rec.token, scopes });
      }
      return { valid: true, scoped: true, credentials };
    } catch {
      return { valid: false, scoped: true, credentials: [] };
    }
  }

  const token = process.env.BRIDGE_TOKEN ?? "";
  return token.length >= 32
    ? { valid: true, scoped: false, credentials: [{ token, scopes: ALL_SCOPES }] }
    : { valid: false, scoped: false, credentials: [] };
}

function extractedToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const alt = req.headers.get("x-bridge-token");
  if (alt) return alt.trim();
  return "";
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function scopesForRequest(req: Request): readonly BridgeScope[] | null {
  const config = readConfig();
  if (!config.valid) return null;
  const given = extractedToken(req);
  if (!given) return null;
  return config.credentials.find(({ token }) => sameToken(given, token))?.scopes ?? null;
}

export function isAuthorized(req: Request, required: readonly BridgeScope[] = []): boolean {
  const scopes = scopesForRequest(req);
  return scopes !== null && required.every((scope) => scopes.includes(scope));
}

export function messageWriteScope(direction: unknown): BridgeScope | null {
  if (direction === "to_grokbot") return "messages:send";
  if (direction === "from_grokbot") return "messages:reply";
  return null;
}

export function hasTokenConfigured(): boolean {
  return readConfig().valid;
}

export function mcpRequiredScopes(body: unknown): readonly BridgeScope[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const request = body as Record<string, unknown>;
  if (request.method === "initialize" || request.method === "notifications/initialized" || request.method === "ping" || request.method === "tools/list") return [];
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object" || Array.isArray(request.params)) return null;
  const params = request.params as Record<string, unknown>;
  if (typeof params.name !== "string") return null;
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? params.arguments as Record<string, unknown>
    : {};
  switch (params.name) {
    case "post_message": {
      const scope = args.direction === undefined ? "messages:reply" : messageWriteScope(args.direction);
      return scope ? [scope] : null;
    }
    case "get_pending_tasks":
      return args.bot_name ? ["messages:read", "jobs:claim"] : ["messages:read"];
    case "list_messages":
      return ["messages:read"];
    case "mark_read":
      return ["messages:mark_read"];
    default:
      return null;
  }
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function misconfigured(): Response {
  return new Response(JSON.stringify({ error: "bridge authentication is not configured correctly" }), {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
