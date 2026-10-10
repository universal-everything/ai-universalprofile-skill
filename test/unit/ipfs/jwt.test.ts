import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { base64url, hs256Signature, signJwtHs256, universalProfileUploadToken } from "../../../src/ipfs/jwt.ts";

const decodePart = (p: string) => JSON.parse(Buffer.from(p, "base64url").toString("utf8"));

describe("HS256 JWT (node:crypto, no dependency)", () => {
  it("matches the RFC 7515 Appendix A.1 HS256 example signature", () => {
    // RFC 7515 A.1: the exact JWS header/payload octets (with CRLF line breaks) and the JWK "k" value
    const header = '{"typ":"JWT",\r\n "alg":"HS256"}';
    const payload = '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}';
    const input = `${base64url(header)}.${base64url(payload)}`;
    expect(input).toBe("eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ");
    const key = Buffer.from("AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow", "base64url");
    expect(hs256Signature(input, key)).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  });

  it("signs header.payload with HMAC-SHA256 of the UTF-8 key (checked independently with createHmac)", () => {
    const key = "test-key-not-a-real-secret";
    const jwt = signJwtHs256({ iss: "extension", iat: 1, exp: 121 }, key);
    const [h, p, s] = jwt.split(".");
    expect(decodePart(h)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decodePart(p)).toEqual({ iss: "extension", iat: 1, exp: 121 });
    const independent = createHmac("sha256", Buffer.from(key, "utf8")).update(`${h}.${p}`).digest("base64url");
    expect(s).toBe(independent);
    expect(jwt).not.toMatch(/[+/=]/); // base64url, unpadded
    expect(() => signJwtHs256({}, "")).toThrow(/empty/);
  });

  it("upload token claims equal the universaleverything.io client: iss extension, iat now/1000, exp (now+120000)/1000", () => {
    const now = 1_760_000_000_123;
    const jwt = universalProfileUploadToken("k", now);
    expect(decodePart(jwt.split(".")[1])).toEqual({ iss: "extension", iat: now / 1000, exp: (now + 120_000) / 1000 });
  });
});
