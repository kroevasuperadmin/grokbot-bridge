#!/usr/bin/env node
// Tell a cloud session something. It hears it within seconds while its listener runs (faris-cccs scripts/listen.py).
//   node scripts/tell_cloud.mjs "message"                # to cloud sessions on faris-cccs
//   node scripts/tell_cloud.mjs "message" other-folder   # to cloud sessions on another folder
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.indexOf("=") < 1) continue;
    const k = t.slice(0, t.indexOf("=")).trim();
    if (!process.env[k]) process.env[k] = t.slice(t.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
  }
} catch {}

const [content, name = "faris-cccs"] = process.argv.slice(2);
if (!content) { console.log('usage: node scripts/tell_cloud.mjs "message" [cloud folder name]'); process.exit(1); }
const res = await fetch(`${(process.env.BRIDGE_URL || "https://grokbot-bridge.vercel.app").replace(/\/$/, "")}/api/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.BRIDGE_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ direction: "to_grokbot", bot_name: `cloud:${name}`, content }),
});
const d = await res.json().catch(() => ({}));
console.log(d.ok ? `told cloud:${name} (${d.message?.id})` : `failed: ${res.status} ${JSON.stringify(d)}`);
