export function cliToken(command, env = process.env) {
  const scoped = env.BRIDGE_TOKENS !== undefined || env.BRIDGE_SCOPED_AUTH === "1";
  if (["read", "wake", "jobs"].includes(command)) {
    return env.BRIDGE_ADMIN_TOKEN || (scoped ? "" : env.BRIDGE_TOKEN || "");
  }
  if (["pending", "inbox", "send"].includes(command)) {
    return env.BRIDGE_TOKEN_CLI || env.BRIDGE_TOKEN || "";
  }
  return "";
}
