#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

const BASE = (process.env.BRIDGE_URL || "http://127.0.0.1:3210").replace(/\/$/, "");
const TOKEN = process.env.BRIDGE_TOKEN || "";
if (!TOKEN) {
  console.error("BRIDGE_TOKEN missing");
  process.exit(1);
}

let failed = 0;
function pass(name) {
  console.log(`PASS  ${name}`);
}
function fail(name, detail) {
  failed += 1;
  console.error(`FAIL  ${name}: ${detail}`);
}

async function req(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }
  return { res, body, text };
}

const health = await req("/api/health");
if (health.res.ok && health.body?.ok) pass("GET /api/health");
else fail("GET /api/health", health.text);

const unauth = await req("/api/messages");
if (unauth.res.status === 401) pass("GET /api/messages rejects missing token");
else fail("GET /api/messages unauth", `${unauth.res.status} ${unauth.text}`);

const bad = await req("/api/messages", {
  headers: { authorization: "Bearer definitely-wrong-token-value-xxxxx" },
});
if (bad.res.status === 401) pass("GET /api/messages rejects bad token");
else fail("GET /api/messages bad token", `${bad.res.status} ${bad.text}`);

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const created = await req("/api/messages", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    direction: "to_grokbot",
    bot_name: "Doomscrollr",
    content: "smoke-task: ping from local curl/node",
  }),
});
if (created.res.status === 201 && created.body?.message?.id) pass("POST /api/messages");
else fail("POST /api/messages", `${created.res.status} ${created.text}`);

const id = created.body?.message?.id;
const pending = await req("/api/messages?direction=to_grokbot&unread=1&bot_name=Doomscrollr", {
  headers: auth,
});
const found = Array.isArray(pending.body?.messages) && pending.body.messages.some((m) => m.id === id);
if (pending.res.ok && found) pass("GET pending contains new message");
else fail("GET pending", pending.text);

const init = await req("/mcp", {
  method: "POST",
  headers: {
    ...auth,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    },
  }),
});
const initOk =
  init.res.ok &&
  (JSON.stringify(init.body).includes("grokbot-bridge") ||
    init.text.includes("grokbot-bridge") ||
    init.text.includes("protocolVersion") ||
    init.text.includes("tools"));
if (initOk) pass("POST /mcp initialize");
else fail("POST /mcp initialize", `${init.res.status} ${init.text.slice(0, 500)}`);

const tools = await req("/mcp", {
  method: "POST",
  headers: {
    ...auth,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
});
const toolText = typeof tools.body === "string" ? tools.body : JSON.stringify(tools.body);
const hasTools =
  toolText.includes("post_message") &&
  toolText.includes("get_pending_tasks") &&
  toolText.includes("list_messages") &&
  toolText.includes("mark_read");
if (tools.res.ok && hasTools) pass("POST /mcp tools/list");
else fail("POST /mcp tools/list", `${tools.res.status} ${toolText.slice(0, 800)}`);

if (id) {
  const marked = await req("/api/messages/read", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ id }),
  });
  if (marked.res.ok && marked.body?.marked >= 1) pass("POST /api/messages/read");
  else fail("POST /api/messages/read", `${marked.res.status} ${marked.text}`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
