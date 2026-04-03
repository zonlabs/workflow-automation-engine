/** Public issuer URL for OAuth metadata (must match how clients reach this server). */
export function getIssuer(): string {
  const port = process.env.WORKFLOW_MCP_PORT ?? "3002";
  return (process.env.WORKFLOW_OAUTH_ISSUER ?? `http://localhost:${port}`).replace(/\/$/, "");
}
