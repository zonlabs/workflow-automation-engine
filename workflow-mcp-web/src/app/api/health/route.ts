import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Quick check that this deployment is the Next app (correct Vercel Root Directory). */
export function GET() {
  return NextResponse.json({ ok: true, service: "workflow-mcp-web" });
}
