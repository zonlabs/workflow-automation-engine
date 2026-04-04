export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>Workflow MCP (Vercel)</h1>
      <p>
        Streamable HTTP MCP endpoint: <code>/api/mcp</code>
      </p>
      <p>
        Script helper (Vercel Sandbox): <code>/api/script-helper/tool</code>,{" "}
        <code>/api/script-helper/llm</code>
      </p>
      <p style={{ color: "#555" }}>
        Set env vars from <code>.env.example</code>, enable Fluid compute on the Vercel project, and
        point Cursor at your deployment URL + <code>/api/mcp</code>.
      </p>
    </main>
  );
}
