#!/usr/bin/env node
// Doorbell: wakes the laptop Claude session the moment a cloud session (or a Grok Bot) posts a message for it.
// Cloud sessions cannot message a local session back, so they post to the bridge instead:
//   POST https://grokbot-bridge.vercel.app/api/messages  {direction:"from_grokbot", bot_name:"cloud:<who>", content:"..."}
// This script checks the bridge every few seconds and prints one line per new message, then marks it read.
// Run it under Claude Code's Monitor tool: every printed line becomes a notification that wakes the session.
//
//   node scripts/doorbell.mjs              # cloud sessions only (bot_name starts with "cloud")
//   node scripts/doorbell.mjs --all        # also Grok Bot replies
//   node scripts/doorbell.mjs --every 5    # seconds between checks (default 5)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.indexOf("=") < 1) continue;
    const k = t.slice(0, t.indexOf("=")).trim();
    if (!process.env[k]) process.env[k] = t.slice(t.indexOf("=") + 1).trim();
  }
} catch {}

const BASE = (process.env.BRIDGE_URL || "https://grokbot-bridge.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.BRIDGE_TOKEN;
if (!TOKEN) { console.log("DOORBELL ERROR: BRIDGE_TOKEN missing"); process.exit(1); }
const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const ALL = process.argv.includes("--all");
const i = process.argv.indexOf("--every");
const EVERY = Math.max(2, Number(i > -1 ? process.argv[i + 1] : 5) || 5) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The bridge stores each message as a file online and a read can return a stale copy for a while,
// so "already rung" is remembered here too (kept on disk so a restart never rings an old message again).
const SEEN_FILE = resolve(here, "..", "data", "doorbell-seen.json");
let seen = new Set();
try { if (existsSync(SEEN_FILE)) seen = new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8"))); } catch {}
const remember = (ids) => { ids.forEach((x) => seen.add(x)); try { writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-2000))); } catch {} };
let failures = 0;
console.log(`DOORBELL armed: checking ${BASE} every ${EVERY / 1000}s for ${ALL ? "cloud sessions and Grok Bots" : "cloud sessions"}`);

for (;;) {
  try {
    const res = await fetch(`${BASE}/api/messages?direction=from_grokbot&unread=1&limit=20`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { messages = [] } = await res.json();
    const mine = messages.filter((m) => !seen.has(m.id) && (ALL || String(m.bot_name || "").toLowerCase().startsWith("cloud")));
    if (mine.length) {
      for (const m of mine.reverse()) {
        const text = String(m.content || "").replace(/\s+/g, " ").slice(0, 500);
        console.log(`DOORBELL from ${m.bot_name} (${m.id}): ${text}`);
      }
      remember(mine.map((m) => m.id));
      await fetch(`${BASE}/api/messages/read`, { method: "POST", headers, body: JSON.stringify({ ids: mine.map((m) => m.id) }) });
    }
    if (failures >= 3) console.log("DOORBELL back online");
    failures = 0;
  } catch (e) {
    failures += 1;
    if (failures === 3) console.log(`DOORBELL ERROR: bridge unreachable 3 times in a row (${String(e.message || e).slice(0, 120)})`);
  }
  await sleep(EVERY);
}
