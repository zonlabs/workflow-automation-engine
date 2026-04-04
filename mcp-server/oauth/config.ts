/** Public issuer URL for OAuth metadata (must match how clients reach this server). */
export function getIssuer(): string {
  const explicit = process.env.WORKFLOW_OAUTH_ISSUER?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  const port = process.env.WORKFLOW_MCP_PORT ?? "3002";
  return `http://localhost:${port}`;
}
