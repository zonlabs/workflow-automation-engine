import { randomBytes } from "node:crypto";

export type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  createdAt: number;
  /** Shown on the authorize page instead of the internal client id. */
  clientName?: string;
  /** Optional https (or localhost http) image URL for the authorize page. */
  logoUri?: string;
};

const clients = new Map<string, RegisteredClient>();

export type RegisterClientInput = {
  redirectUris: string[];
  clientName?: string;
  logoUri?: string;
};

export function registerClient(input: RegisterClientInput): RegisteredClient {
  const { redirectUris, clientName, logoUri } = input;
  const clientId = `mcp-client-${randomBytes(16).toString("hex")}`;
  const rec: RegisteredClient = {
    clientId,
    redirectUris: redirectUris.length > 0 ? redirectUris : ["http://localhost:8080/callback"],
    createdAt: Date.now(),
    ...(clientName ? { clientName } : {}),
    ...(logoUri ? { logoUri } : {}),
  };
  clients.set(clientId, rec);
  return rec;
}

export function getClient(clientId: string): RegisteredClient | undefined {
  return clients.get(clientId);
}
