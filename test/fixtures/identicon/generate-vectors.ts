// Regenerates vectors.json from the verbatim upstream source (test infrastructure).
//   node test/fixtures/identicon/generate-vectors.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadUpstreamMakeBlockie, UPSTREAM_SOURCE } from "./upstream.ts";

export const VECTOR_ADDRESSES = [
  "0x7cB57B5A97eAbe94205C07890BE4c1aD31E486A8", // upstream README example
  "0x7cb57b5a97eabe94205c07890be4c1ad31e486a8", // same, lower-case (must be identical)
  "0x0000000000000000000000000000000000000000",
  "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f",
  "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA", // LSP26 Follower System
  "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F", // UniversalProfileInit v0.14.0
  "0xcA11bde05977b3631167028862bE2a173976CA11", // Multicall3
  "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
];

const makeBlockie = loadUpstreamMakeBlockie();
const out = {
  note: "Golden identicons produced by running the verbatim upstream ethereum-blockies-base64 source (test/fixtures/identicon/upstream/) in a node:vm sandbox. Our port must decode to the same pixels.",
  source: UPSTREAM_SOURCE,
  method: "node test/fixtures/identicon/generate-vectors.ts (node:vm, empty global context, CommonJS shim; files verified by sha256 before execution)",
  generatedAt: new Date().toISOString(),
  vectors: VECTOR_ADDRESSES.map((address) => ({ address, dataUri: makeBlockie(address) })),
};
writeFileSync(join(import.meta.dirname, "vectors.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.vectors.length} vectors`);
