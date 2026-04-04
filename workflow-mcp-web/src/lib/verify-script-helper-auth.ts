/**
 * Script-helper routes are called from Vercel Sandbox user code (engine `script-runner.ts`).
 * On Vercel / production, WORKFLOW_SCRIPT_HELPER_TOKEN must be set so callbacks are not public.
 */

/** Returns an error Response if the request is not allowed; otherwise null. */
export function verifyScriptHelperAuth(req: Request): Response | null {
  const helperToken = process.env.WORKFLOW_SCRIPT_HELPER_TOKEN?.trim();
  const productionLike = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (!helperToken) {
    if (productionLike) {
      return Response.json(
        {
          error:
            "WORKFLOW_SCRIPT_HELPER_TOKEN is not set. Required on Vercel so sandbox callbacks are not open to the public. See workflow-mcp-web README (Vercel Sandbox).",
        },
        { status: 503 }
      );
    }
    return null;
  }

  const auth = req.headers.get("authorization");
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== helperToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
