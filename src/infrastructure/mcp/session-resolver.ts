import { storage } from "@mcp-ts/sdk/server";

export class McpSessionResolver {
  async resolveActiveSessionId(userId: string): Promise<string | null> {
    try {
      const sessions = await storage.getIdentitySessionsData(userId);
      const match = sessions.find(
        (session: { active?: boolean; sessionId?: string }) => session.active !== false
      );
      if (match?.sessionId) {
        return String(match.sessionId);
      }
    } catch (err) {
      console.warn(
        `[session-resolver] Failed to resolve session for ${userId}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
    return null;
  }

  async assertSessionExists(identity: string, sessionId: string): Promise<void> {
    const sessions = await storage.getIdentitySessionsData(identity);
    const hasSession = sessions.some(
      (session: { sessionId: string }) => session.sessionId === sessionId
    );
    if (!hasSession) {
      throw new Error(`Session ${sessionId} was not found for identity ${identity}`);
    }
  }
}
