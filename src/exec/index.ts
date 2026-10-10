// Registers the account-core transports (km, lsp0, relay). The opt-in "userop"
// transport is registered by the ERC-4337 module.
import { registerTransport } from "./transport.ts";
import { kmTransport } from "./km.ts";
import { lsp0Transport } from "./lsp0.ts";
import { relayTransport } from "./relay.ts";

registerTransport(kmTransport);
registerTransport(lsp0Transport);
registerTransport(relayTransport);

export { kmTransport, lsp0Transport, relayTransport };
export { executeAuto, resolveAutoPath } from "./auto.ts";
export type { ExecOptionsExt, ExecRequestExt } from "./common.ts";
