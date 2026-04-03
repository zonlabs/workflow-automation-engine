import { createHash } from "node:crypto";

/** RFC 7636 PKCE verification (S256 / plain). */
export function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: string = "S256"
): boolean {
  if (codeChallengeMethod === "plain") {
    return codeVerifier === codeChallenge;
  }
  if (codeChallengeMethod === "S256") {
    const digest = createHash("sha256").update(codeVerifier, "ascii").digest();
    const expected = digest
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return expected === codeChallenge;
  }
  return false;
}
