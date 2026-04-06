/** Dangerous schemes — never allow as OAuth redirect targets. */
const BLOCKED_CUSTOM_SCHEMES = new Set(["javascript", "data", "vbscript"]);

/** Human-readable policy for OAuth error responses (kept in sync with `isAllowedRedirectUri`). */
export function describeRedirectUriPolicyForError(): string {
  return (
    "https://..., http://localhost|127.0.0.1, or any custom URL scheme " +
    "(blocked: javascript, data, vbscript)"
  );
}

export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    const scheme = u.protocol.replace(/:$/, "").toLowerCase();
    if (!scheme || BLOCKED_CUSTOM_SCHEMES.has(scheme)) return false;
    return true;
  } catch {
    return false;
  }
}
