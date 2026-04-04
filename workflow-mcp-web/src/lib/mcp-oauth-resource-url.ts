/**
 * `withMcpAuth` sets `resource_metadata` to `${resourceUrl}${resourceMetadataPath}`.
 * When `WORKFLOW_MCP_RESOURCE_URL` is the MCP base (e.g. `https://host/api/mcp`), that yields
 * `https://host/api/mcp/.well-known/oauth-protected-resource` — same pattern as `mcp-server/main.ts`.
 * We serve that path via `app/api/mcp/.well-known/oauth-protected-resource/route.ts`.
 */
export function resolveMcpOAuthResourceUrls(): {
  /** Passed to `withMcpAuth({ resourceUrl })` when set */
  authResourceBase?: string;
  /** `resource` in protected-resource metadata JSON */
  protectedResourceUri?: string;
} {
  const raw = process.env.WORKFLOW_MCP_RESOURCE_URL?.trim().replace(/\/$/, "");
  if (!raw) return {};
  return { authResourceBase: raw, protectedResourceUri: raw };
}
