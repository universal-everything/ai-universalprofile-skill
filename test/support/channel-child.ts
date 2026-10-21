// Test helper (never shipped): one process asking for the profile's relay channel, with the real CSPRNG.
// Run as: node --import tsx channel-child.ts <ensure|read> <home> <identity>; prints {"channel": "...", "created": bool}.
import { ensureRelayChannel, relayChannelState } from "../../src/lsp/relay-channel.ts";

const [mode, home, identity] = process.argv.slice(2) as [string, string, `0x${string}`];
const r = mode === "ensure" ? await ensureRelayChannel(home, identity) : (await relayChannelState(home, identity)).saved;
process.stdout.write(JSON.stringify({ channel: r ? r.channel.toString() : null, created: !!(r && "created" in r && r.created) }) + "\n");
