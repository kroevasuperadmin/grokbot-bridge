import test from "node:test";
import assert from "node:assert/strict";
import { cliToken } from "./cli-token.mjs";
import { watcherBridgeEnv } from "../../gtm_links/night/watcher-auth.mjs";

test("room commands use the CLI token override, then the shared room token", () => {
  assert.equal(cliToken("inbox", { BRIDGE_TOKEN_CLI: "cli", BRIDGE_TOKEN: "room" }), "cli");
  assert.equal(cliToken("send", { BRIDGE_TOKEN: "room" }), "room");
  assert.equal(cliToken("pending", { BRIDGE_TOKENS: "configured", BRIDGE_TOKEN: "room" }), "room");
});

test("operator commands use the admin token and fail closed in scoped mode", () => {
  assert.equal(cliToken("read", { BRIDGE_ADMIN_TOKEN: "admin", BRIDGE_TOKEN: "room" }), "admin");
  assert.equal(cliToken("wake", { BRIDGE_TOKENS: "configured", BRIDGE_TOKEN: "room" }), "");
  assert.equal(cliToken("read", { BRIDGE_SCOPED_AUTH: "1", BRIDGE_TOKEN: "room" }), "");
  assert.equal(cliToken("wake", { BRIDGE_TOKEN: "legacy" }), "legacy");
});

test("watcher overrides the CLI room token without changing shared token state", () => {
  const env = watcherBridgeEnv({ BRIDGE_TOKEN: "room", BRIDGE_TOKEN_CLI: "cli", BRIDGE_TOKEN_WATCHER: "watcher" });
  assert.equal(env.BRIDGE_TOKEN_CLI, "watcher");
  assert.equal(env.BRIDGE_TOKEN, "room");
  assert.equal(watcherBridgeEnv({ BRIDGE_TOKEN: "room" }).BRIDGE_TOKEN_CLI, "room");
});
