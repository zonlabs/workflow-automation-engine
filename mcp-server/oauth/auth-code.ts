import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";

let devEphemeralSecret: string | null = null;
let devEphemeralWarned = false;

function resolveCodeSecret(): string {
  const configured = process.env.WORKFLOW_OAUTH_CODE_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "WORKFLOW_OAUTH_CODE_SECRET must be set (at least 16 characters) in production."
    );
  }

  if (!devEphemeralSecret) {
    devEphemeralSecret = randomBytes(32).toString("hex");
    if (!devEphemeralWarned) {
      devEphemeralWarned = true;
      console.warn(
        "[workflow-oauth] WORKFLOW_OAUTH_CODE_SECRET is not set; using an ephemeral dev secret. " +
          "Authorization codes break after server restart. Set WORKFLOW_OAUTH_CODE_SECRET in .env for stable local OAuth."
      );
    }
  }
  return devEphemeralSecret;
}

function deriveKey(): Buffer {
  return scryptSync(resolveCodeSecret(), "workflow-oauth-code-v1", 32);
}

export type SealedAuthCodePayload = {
  access_token: string;
  exp: number;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
};

export function sealAuthCode(payload: SealedAuthCodePayload): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function openAuthCode(sealed: string): SealedAuthCodePayload {
  const buf = Buffer.from(sealed, "base64url");
  if (buf.length < 12 + 16) {
    throw new Error("invalid_code");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  return JSON.parse(json) as SealedAuthCodePayload;
}
