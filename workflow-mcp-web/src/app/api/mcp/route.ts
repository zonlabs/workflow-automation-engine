import {
  handleWorkflowMcpRequest,
  normalizeRequestUrl,
} from "@/lib/workflow-mcp-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * CORS preflight: mcp-handler does not handle OPTIONS on `/api/mcp`, which would fall through to 404.
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "authorization, content-type, accept, mcp-session-id, last-event-id",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(req: Request) {
  return handleWorkflowMcpRequest(normalizeRequestUrl(req));
}

export async function POST(req: Request) {
  return handleWorkflowMcpRequest(normalizeRequestUrl(req));
}

export async function DELETE(req: Request) {
  return handleWorkflowMcpRequest(normalizeRequestUrl(req));
}
