#!/usr/bin/env node
import { loadEnvLocal } from "./env.mjs";
import { cliToken } from "./cli-token.mjs";

loadEnvLocal();

const BASE = (process.env.BRIDGE_URL || "http://127.0.0.1:3210").replace(/\/$/, "");
const cmd = process.argv[2] || "help";

function authHeaders(command) {
  const token = cliToken(command, process.env);
  if (!token) {
    console.error(["read", "wake", "jobs"].includes(command)
      ? "BRIDGE_ADMIN_TOKEN missing in scoped mode"
      : "BRIDGE_TOKEN_CLI or BRIDGE_TOKEN missing");
    process.exit(1);
  }
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function rest() {
  const i = process.argv.indexOf("--");
  if (i !== -1) return process.argv.slice(i + 1).join(" ");
  return "";
}

async function call(path, init, command = cmd) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...authHeaders(command), ...(init?.headers || {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error(res.status, body);
    process.exit(1);
  }
  return body;
}

if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(`Usage:
  node scripts/bridge.mjs pending [--bot Herald]
  node scripts/bridge.mjs inbox [--bot Herald] [--unread] [--direction from_grokbot]
  node scripts/bridge.mjs send --to grokbot --bot Doomscrollr -- "task text"
  node scripts/bridge.mjs send --from grokbot --bot Herald -- "finding"
  node scripts/bridge.mjs read <id>
  node scripts/bridge.mjs read --all [--direction from_grokbot] [--bot Herald]
  node scripts/bridge.mjs health
  node scripts/bridge.mjs wake        (count approved board jobs, poke Wisma if any)
`);
  process.exit(0);
}

async function wake() {
  const body = await call("/api/sync", undefined, "wake");
  console.log(JSON.stringify(body, null, 2));
  return body;
}

if (cmd === "wake") {
  await wake();
  process.exit(0);
}

if (cmd === "health") {
  const res = await fetch(`${BASE}/api/health`);
  console.log(await res.text());
  process.exit(0);
}

if (cmd === "pending") {
  const bot = arg("--bot");
  const qs = new URLSearchParams({ direction: "to_grokbot", unread: "1" });
  if (bot) qs.set("bot_name", bot);
  console.log(JSON.stringify(await call(`/api/messages?${qs}`), null, 2));
  process.exit(0);
}

if (cmd === "inbox") {
  const bot = arg("--bot");
  const direction = arg("--direction", "from_grokbot");
  const unread = process.argv.includes("--unread");
  const qs = new URLSearchParams({ direction });
  if (bot) qs.set("bot_name", bot);
  if (unread) qs.set("unread", "1");
  console.log(JSON.stringify(await call(`/api/messages?${qs}`), null, 2));
  process.exit(0);
}

if (cmd === "send") {
  const toGrok = process.argv.includes("--to");
  const fromGrok = process.argv.includes("--from");
  const bot = arg("--bot");
  const content = rest() || arg("--content");
  if (!bot || !content) {
    console.error("need --bot NAME and -- message");
    process.exit(1);
  }
  const direction = fromGrok && !toGrok ? "from_grokbot" : "to_grokbot";
  const body = await call("/api/messages", {
    method: "POST",
    body: JSON.stringify({ direction, bot_name: bot, content }),
  });
  console.log(JSON.stringify(body, null, 2));
  // A task for a bot should be looked at now, not on Wisma's next scheduled run.
  if (direction === "to_grokbot") {
    if (cliToken("wake", process.env)) await wake();
    else console.error("Message sent. Wake skipped because BRIDGE_ADMIN_TOKEN is missing in scoped mode.");
  }
  process.exit(0);
}

if (cmd === "read") {
  if (process.argv.includes("--all")) {
    const body = await call("/api/messages/read", {
      method: "POST",
      body: JSON.stringify({
        all: true,
        bot_name: arg("--bot"),
        direction: arg("--direction"),
      }),
    });
    console.log(JSON.stringify(body, null, 2));
    process.exit(0);
  }
  const id = process.argv[3];
  if (!id) {
    console.error("need id or --all");
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      await call("/api/messages/read", { method: "POST", body: JSON.stringify({ id }) }),
      null,
      2,
    ),
  );
  process.exit(0);
}

console.error(`unknown command: ${cmd}`);
process.exit(1);
