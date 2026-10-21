import test from "node:test";
import assert from "node:assert/strict";
import { hasTokenConfigured, isAuthorized, mcpRequiredScopes, messageWriteScope, REST_SCOPES } from "../lib/auth.ts";

const tokens = {
  reader: "r".repeat(40),
  sender: "s".repeat(40),
  replier: "p".repeat(40),
  marker: "m".repeat(40),
  jobRunner: "j".repeat(40),
  syncer: "y".repeat(40),
};

function configure(entries, legacy = "l".repeat(40)) {
  process.env.BRIDGE_TOKEN = legacy;
  process.env.BRIDGE_TOKENS = JSON.stringify(entries);
}

function request(token, header = "authorization") {
  return new Request("https://bridge.test", {
    headers: header === "authorization" ? { authorization: `Bearer ${token}` } : { "x-bridge-token": token },
  });
}

test("scoped route permissions allow only the assigned action", () => {
  configure({
    reader: { token: tokens.reader, scopes: ["messages:read"] },
    sender: { token: tokens.sender, scopes: ["messages:send"] },
    replier: { token: tokens.replier, scopes: ["messages:reply"] },
    marker: { token: tokens.marker, scopes: ["messages:mark_read"] },
    jobRunner: { token: tokens.jobRunner, scopes: ["jobs:claim"] },
    syncer: { token: tokens.syncer, scopes: ["sync:run"] },
  });
  const cases = [
    [tokens.reader, "messages:read"],
    [tokens.sender, "messages:send"],
    [tokens.replier, "messages:reply"],
    [tokens.marker, "messages:mark_read"],
    [tokens.jobRunner, "jobs:claim"],
    [tokens.syncer, "sync:run"],
  ];
  for (const [token, allowed] of cases) {
    assert.equal(isAuthorized(request(token), [allowed]), true, `${allowed} should allow its own token`);
    for (const [, denied] of cases) {
      if (denied !== allowed) assert.equal(isAuthorized(request(token), [denied]), false, `${allowed} must not grant ${denied}`);
    }
  }
  assert.equal(isAuthorized(request(tokens.reader, "x-bridge-token"), ["messages:read"]), true);
  assert.equal(isAuthorized(request("x".repeat(40)), ["messages:read"]), false);

  const routeCases = [
    [tokens.reader, REST_SCOPES.messagesGet],
    [tokens.marker, REST_SCOPES.messagesReadPost],
    [tokens.jobRunner, REST_SCOPES.jobsGet],
    [tokens.syncer, REST_SCOPES.syncGet],
  ];
  for (const [token, required] of routeCases) {
    assert.equal(isAuthorized(request(token), required), true);
    for (const [otherToken] of routeCases) {
      if (otherToken !== token) assert.equal(isAuthorized(request(otherToken), required), false);
    }
  }
  assert.equal(isAuthorized(request(tokens.sender), [messageWriteScope("to_grokbot")]), true);
  assert.equal(isAuthorized(request(tokens.sender), [messageWriteScope("from_grokbot")]), false);
  assert.equal(isAuthorized(request(tokens.replier), [messageWriteScope("from_grokbot")]), true);
  assert.equal(messageWriteScope("unexpected"), null);
});

test("MCP method and tool scopes fail closed", () => {
  assert.deepEqual(mcpRequiredScopes({ method: "initialize" }), []);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/list" }), []);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/call", params: { name: "post_message", arguments: { direction: "to_grokbot" } } }), ["messages:send"]);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/call", params: { name: "post_message" } }), ["messages:reply"]);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/call", params: { name: "get_pending_tasks" } }), ["messages:read"]);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/call", params: { name: "get_pending_tasks", arguments: { bot_name: "herald" } } }), ["messages:read", "jobs:claim"]);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/call", params: { name: "list_messages" } }), ["messages:read"]);
  assert.deepEqual(mcpRequiredScopes({ method: "tools/call", params: { name: "mark_read" } }), ["messages:mark_read"]);
  assert.equal(mcpRequiredScopes({ method: "tools/call", params: { name: "future_write_tool" } }), null);
  assert.equal(mcpRequiredScopes({ method: "future/method" }), null);
});

test("legacy token grants compatibility scopes only when scoped map is absent", () => {
  delete process.env.BRIDGE_TOKENS;
  process.env.BRIDGE_TOKEN = "l".repeat(40);
  assert.equal(hasTokenConfigured(), true);
  for (const scope of ["messages:read", "messages:send", "messages:reply", "messages:mark_read", "jobs:claim", "sync:run"]) {
    assert.equal(isAuthorized(request(process.env.BRIDGE_TOKEN), [scope]), true);
  }
});

test("malformed scoped configuration fails closed and never falls back", () => {
  process.env.BRIDGE_TOKEN = "l".repeat(40);
  for (const raw of ["", "{bad", "{}", JSON.stringify({ client: { token: "short", scopes: ["messages:read"] } }), JSON.stringify({ client: { token: "a".repeat(40), scopes: ["unknown:scope"] } }), JSON.stringify({ a: { token: "d".repeat(40), scopes: ["messages:read"] }, b: { token: "d".repeat(40), scopes: ["messages:send"] } })]) {
    process.env.BRIDGE_TOKENS = raw;
    assert.equal(hasTokenConfigured(), false);
    assert.equal(isAuthorized(request(process.env.BRIDGE_TOKEN), []), false);
  }
});

test("context session cookie is private and same-site", async () => {
  process.env.CONTEXT_PAGE_KEY = "c".repeat(40);
  const { sessionCookie, hasSession, isContextName, contextListingFiles } = await import("../lib/context-gate.ts");
  const cookie = sessionCookie(Math.floor(Date.now() / 1000) + 60);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(hasSession(new Request("https://bridge.test/context", { headers: { cookie: cookie.split(";")[0] } })), true);
  assert.equal(isContextName("reference_ok.md", ["reference_ok.md"]), true);
  assert.equal(isContextName("../outside.md", ["../outside.md"]), false);
  assert.equal(isContextName("C:\\outside.md", ["C:\\outside.md"]), false);
  assert.equal(isContextName("not-indexed.md", []), false);
  const names = contextListingFiles(["reference_linked.md", "../outside.md"]);
  assert.ok(names.includes("reference_linked.md"));
  assert.ok(names.includes("NOTES_FROM_ASSISTANT.md"));
  assert.ok(!names.includes("../outside.md"));
});
