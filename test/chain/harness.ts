// Local-chain test harness (never shipped):
//  - in-process EVM (Hardhat 3 / EDR) exposed over a real HTTP JSON-RPC endpoint,
//    so the skill's production RPC client (health checks, failover) is exercised;
//  - Nick's deterministic deployment proxy installed at its canonical address;
//  - the canonical LSP stack (LSP23 factory, post-deployment modules, UP/KM/URD
//    v0.14.0 implementations, ERCTokenCallbacks) deployed through Nick's factory
//    with the upstream salts and creation bytecode, so every address equals the
//    real mainnet address and the registry/precompute logic is tested as-is.
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { concat, getAddress, getContractAddress, type Address, type Hex } from "viem";

export const LOCAL_CHAIN_ID = 31337;
/** Second, independent in-process chain (multichain tests): same accounts and canonical LSP stack, different chain id and state. */
export const SECOND_CHAIN_ID = 31338;
export const NICK_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const NICK_RUNTIME = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3" as Hex; // eth_getCode on LUKSO mainnet

const root = join(import.meta.dirname, "..", "..");
const contractsDir = join(root, "skills", "universal-profile", "assets", "registry", "lsp-deployments", "contracts");
export const fixture = (name: string) => JSON.parse(readFileSync(join(root, "test", "fixtures", "bytecode", `${name}.json`), "utf8"));

export interface Harness {
  rpcUrl: string;
  chainId: number;
  provider: { request(args: { method: string; params?: unknown[] }): Promise<any> };
  accounts: Address[];
  request<T = any>(method: string, params?: unknown[]): Promise<T>;
  fund(address: Address, wei: bigint): Promise<void>;
  sendFrom(from: Address, to: Address | undefined, data: Hex, value?: bigint): Promise<{ hash: Hex; receipt: any }>;
  deployViaNick(salt: Hex, initCode: Hex): Promise<Address>;
  deployRaw(initCode: Hex, from?: Address): Promise<Address>;
  /** temp UP_HOME with a registry overlay declaring the local chain */
  newHome(): string;
  /** registry overlay entry of this chain (see multiChainHome) */
  overlayChain: Record<string, unknown>;
  close(): Promise<void>;
  lsp: Record<string, Address>;
}

let shared: Promise<Harness> | undefined;
let second: Promise<Harness> | undefined;

export function getHarness(): Promise<Harness> {
  return (shared ??= startHarness({ chainId: LOCAL_CHAIN_ID, name: "Local test EVM", slug: "local" }));
}

/** A second chain in the same process (separate EDR instance and HTTP endpoint). */
export function getSecondHarness(): Promise<Harness> {
  return (second ??= startHarness({ chainId: SECOND_CHAIN_ID, name: "Second test EVM", slug: "local-b" }));
}

/** temp UP_HOME whose registry overlay and config declare every given chain (the first is the default chain). */
export function multiChainHome(hs: Harness[]): string {
  const home = mkdtempSync(join(tmpdir(), "up-home-"));
  mkdirSync(join(home, "cache", "registry"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "cache", "registry", "overlay.json"), JSON.stringify({ chains: hs.map((x) => x.overlayChain) }));
  writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, defaultChain: hs[0].chainId, chains: hs.map((x) => x.chainId) }), { mode: 0o600 });
  return home;
}

async function startHarness(spec: { chainId: number; name: string; slug: string }): Promise<Harness> {
  process.env.UP_RPC_ALLOW_STALE = "1";
  process.env.UP_POLL_MS = "50";
  const { network } = await import("hardhat");
  const conn = spec.chainId === LOCAL_CHAIN_ID ? await network.connect() : await network.connect({ override: { chainId: spec.chainId } as any });
  const provider = conn.provider as unknown as Harness["provider"];
  const request = <T = any>(method: string, params: unknown[] = []) => provider.request({ method, params }) as Promise<T>;

  const server: Server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const handle = async (msg: any) => {
      try {
        const result = await provider.request({ method: msg.method, params: msg.params ?? [] });
        return { jsonrpc: "2.0", id: msg.id, result };
      } catch (e: any) {
        return { jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32000, message: e.message ?? String(e), data: e.data } };
      }
    };
    let out: unknown;
    try {
      const parsed = JSON.parse(body);
      out = Array.isArray(parsed) ? await Promise.all(parsed.map(handle)) : await handle(parsed);
    } catch {
      out = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v)));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const rpcUrl = `http://127.0.0.1:${port}`;

  const accounts = ((await request<string[]>("eth_accounts")) ?? []).map((a) => getAddress(a));
  const deployer = accounts[0];

  const waitReceipt = async (hash: Hex) => {
    for (let i = 0; i < 200; i++) {
      const r = await request("eth_getTransactionReceipt", [hash]);
      if (r) return r;
      await request("evm_mine", []).catch(() => {});
    }
    throw new Error(`no receipt for ${hash}`);
  };
  const sendFrom = async (from: Address, to: Address | undefined, data: Hex, value = 0n) => {
    const hash = await request<Hex>("eth_sendTransaction", [{ from, to, data, value: "0x" + value.toString(16), gas: "0xF00000" }]);
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "0x1") throw new Error(`tx ${hash} reverted`);
    return { hash, receipt };
  };

  await request("hardhat_setCode", [NICK_FACTORY, NICK_RUNTIME]);
  const deployViaNick = async (salt: Hex, initCode: Hex) => {
    const expected = getContractAddress({ opcode: "CREATE2", from: NICK_FACTORY, salt, bytecode: initCode });
    const code = await request<Hex>("eth_getCode", [expected, "latest"]);
    if (code && code !== "0x") return expected;
    await sendFrom(deployer, NICK_FACTORY, concat([salt, initCode]));
    const after = await request<Hex>("eth_getCode", [expected, "latest"]);
    if (!after || after === "0x") throw new Error(`Nick deployment produced no code at ${expected}`);
    return expected;
  };
  const deployRaw = async (initCode: Hex, from: Address = deployer) => {
    const { receipt } = await sendFrom(from, undefined, initCode);
    return getAddress(receipt.contractAddress);
  };

  // Canonical LSP stack.
  const lsp: Record<string, Address> = {};
  const readEntry = (n: string) => JSON.parse(readFileSync(join(contractsDir, `${n}.json`), "utf8"));
  for (const n of ["LSP23LinkedContractsFactory", "UniversalProfileInitPostDeploymentModule", "UniversalProfilePostDeploymentModule", "ERCTokenCallbacks"]) {
    const e = readEntry(n);
    const addr = await deployViaNick(e.salt, e.creationBytecode);
    if (addr.toLowerCase() !== e.address.toLowerCase()) throw new Error(`${n}: deployed at ${addr}, expected ${e.address}`);
    lsp[n] = addr;
  }
  for (const n of ["UniversalProfileInit", "LSP6KeyManagerInit", "LSP1UniversalReceiverDelegateUP"]) {
    const e = readEntry(n);
    for (const v of e.versions) {
      const init: Hex = v.constructorParams?.length ? (() => {
        throw new Error(`${n} ${v.version} has constructor params; extend harness`);
      })() : v.creationBytecode;
      const addr = await deployViaNick(v.salt, init);
      if (addr.toLowerCase() !== v.address.toLowerCase()) throw new Error(`${n} ${v.version}: deployed at ${addr}, expected ${v.address}`);
      lsp[`${n}@${v.version}`] = addr;
    }
  }

  const overlayChain = {
    chainId: spec.chainId,
    name: spec.name,
    slug: spec.slug,
    nativeSymbol: "ETH",
    testnet: true,
    rpcs: [{ url: rpcUrl, source: "user", trust: "user" }],
    explorers: [],
    lsp: { deployed: true, versions: { LSP23LinkedContractsFactory: ["singleton"], UniversalProfileInit: ["0.14.0", "0.12.1"] } },
    relayers: [],
    staleAfterSec: 1e9,
    confirmations: 1,
  };
  const newHome = () => {
    const home = mkdtempSync(join(tmpdir(), "up-home-"));
    mkdirSync(join(home, "cache", "registry"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, "cache", "registry", "overlay.json"), JSON.stringify({ chains: [overlayChain] }));
    writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, defaultChain: spec.chainId, chains: [spec.chainId] }), { mode: 0o600 });
    return home;
  };

  return {
    rpcUrl,
    chainId: spec.chainId,
    overlayChain,
    provider,
    accounts,
    request,
    async fund(address, wei) {
      await request("hardhat_setBalance", [address, "0x" + wei.toString(16)]);
    },
    sendFrom,
    deployViaNick,
    deployRaw,
    newHome,
    lsp,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await conn.close?.();
    },
  };
}
