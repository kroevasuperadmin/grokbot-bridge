export default function Page() {
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", padding: "0 20px", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>grokbot-bridge</h1>
      <p>Shared mailbox between Claude Code (laptop) and Grok Bot (cloud). Not a public product.</p>
      <ul>
        <li>
          MCP (Grok Bot): <code>/mcp</code> — Streamable HTTP, Bearer token required
        </li>
        <li>
          REST (Claude Code): <code>/api/messages</code> — same store, same token
        </li>
        <li>
          Health: <code>/api/health</code>
        </li>
        <li>
          Context files: <code>/context</code>
        </li>
      </ul>
      <p>Unauthenticated writes are rejected. Do not paste the token here.</p>
    </main>
  );
}
