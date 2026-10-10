// Minimal HS256 JSON Web Token signing (RFC 7519 / RFC 7515) with node:crypto, used to
// authenticate uploads to the Universal Profile IPFS API. No dependency: the token is
// base64url(header) "." base64url(payload) "." base64url(HMAC-SHA256(key, signing input)).
// The key is used as raw bytes (a string key as its UTF-8 bytes, like
// @tsndr/cloudflare-worker-jwt, which the official universaleverything.io client uses).
import { createHmac } from "node:crypto";

export function base64url(data: Uint8Array | string): string {
  return Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : data).toString("base64url");
}

/** HMAC-SHA256 over the JWS signing input, base64url-encoded. */
export function hs256Signature(signingInput: string, key: string | Uint8Array): string {
  return createHmac("sha256", typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key)).update(signingInput, "utf8").digest("base64url");
}

/** Signs a JWT with HS256. The header is {"alg":"HS256","typ":"JWT"}. */
export function signJwtHs256(payload: Record<string, unknown>, key: string | Uint8Array): string {
  if ((typeof key === "string" ? key.length : key.byteLength) === 0) throw new Error("empty HS256 key");
  const input = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  return `${input}.${hs256Signature(input, key)}`;
}

/**
 * The short-lived upload token of the Universal Profile IPFS API: the same claims as the
 * official universaleverything.io frontend (services/ipfs/authenticated-formdata-client.ts):
 * { iss: "extension", iat: now/1000, exp: (now + 120000)/1000 } (seconds, may be fractional).
 */
export function universalProfileUploadToken(key: string, now = Date.now()): string {
  return signJwtHs256({ iss: "extension", iat: now / 1000, exp: (now + 120_000) / 1000 }, key);
}
