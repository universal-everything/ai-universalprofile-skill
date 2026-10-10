// Generates skills/universal-profile/assets/registry/** from pinned public sources:
//  1. lsp-smart-contracts `deployments/` at a pinned commit — mirrored verbatim
//     (contracts.json is split per contract because it exceeds the 1 MiB/file
//     limit of skill bundles; the split is lossless and checked by sha256).
//  2. Chainlist (https://chainlist.org/rpcs.json) — snapshot of RPC endpoints with
//     tracking labels, filtered to the chains in the LUKSO registry.
//  3. Hand-verified protocol addresses (build/protocols.source.json) — every entry
//     carries a source URL and a verification date.
// Usage: node build/gen-registry.mjs [--commit <sha>] [--offline <dir-with-deployments>]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reg = join(root, "skills", "universal-profile", "assets", "registry");
const mirror = join(reg, "lsp-deployments");
const args = process.argv.slice(2);
const argVal = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const COMMIT = argVal("--commit") ?? "16ab2441a79c34da56386c30caa00c33379ce06f";
const OFFLINE = argVal("--offline");
const REPO = "lukso-network/lsp-smart-contracts";
const RAW = (p) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${p}`;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const now = new Date().toISOString();

async function fetchText(url) {
  const r = await fetch(url, { headers: { "user-agent": "universal-profile-skill-registry-generator" } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.text();
}
async function getDeploymentFile(name) {
  if (OFFLINE) return readFileSync(join(OFFLINE, name), "utf8");
  return fetchText(RAW(`deployments/${name}`));
}
const writeJson = (file, v) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
};

rmSync(mirror, { recursive: true, force: true });
mkdirSync(join(mirror, "contracts"), { recursive: true });
mkdirSync(join(mirror, "abi"), { recursive: true });

// ---------------------------------------------------------------------------
// 1) Mirror deployments/
// ---------------------------------------------------------------------------
const provenance = { repository: `https://github.com/${REPO}`, commit: COMMIT, path: "deployments/", mirroredAt: now, files: {} };
for (const f of ["DEPLOYED_CHAINS.md", "README.md", "chains-mainnet.json", "chains-testnet.json"]) {
  const txt = await getDeploymentFile(f);
  writeFileSync(join(mirror, f), txt);
  provenance.files[f] = { sha256: sha256(txt), bytes: Buffer.byteLength(txt), url: RAW(`deployments/${f}`) };
}
const contractsTxt = await getDeploymentFile("contracts.json");
const contracts = JSON.parse(contractsTxt);
provenance.files["contracts.json"] = {
  sha256: sha256(contractsTxt),
  bytes: Buffer.byteLength(contractsTxt),
  url: RAW("deployments/contracts.json"),
  storedAs: "contracts/<ContractName>.json (lossless split; object key order preserved in contracts/INDEX.json)",
};
writeJson(join(mirror, "contracts", "INDEX.json"), { order: Object.keys(contracts), sourceSha256: sha256(contractsTxt) });
for (const [name, entry] of Object.entries(contracts)) writeJson(join(mirror, "contracts", `${name}.json`), entry);
// lossless check: reassemble and compare semantic equality
{
  const re = {};
  for (const n of Object.keys(contracts)) re[n] = JSON.parse(readFileSync(join(mirror, "contracts", `${n}.json`), "utf8"));
  if (JSON.stringify(re) !== JSON.stringify(contracts)) throw new Error("contracts.json split is not lossless");
}

// ABIs published upstream under deployments/abi/
let abiNames;
if (OFFLINE) abiNames = readdirSync(join(OFFLINE, "abi"));
else {
  const listing = JSON.parse(await fetchText(`https://api.github.com/repos/${REPO}/contents/deployments/abi?ref=${COMMIT}`));
  abiNames = listing.map((e) => e.name);
}
for (const n of abiNames) {
  const txt = OFFLINE ? readFileSync(join(OFFLINE, "abi", n), "utf8") : await fetchText(RAW(`deployments/abi/${n}`));
  writeFileSync(join(mirror, "abi", n), txt);
  provenance.files[`abi/${n}`] = { sha256: sha256(txt), bytes: Buffer.byteLength(txt), url: RAW(`deployments/abi/${n}`) };
}
writeJson(join(mirror, "PROVENANCE.json"), provenance);

// ---------------------------------------------------------------------------
// 2) Parse DEPLOYED_CHAINS.md for per-chain deployment status
// ---------------------------------------------------------------------------
const md = readFileSync(join(mirror, "DEPLOYED_CHAINS.md"), "utf8");
const perChain = new Map(); // chainId -> { versions: {Contract:[v...]}, missing: [...] }
for (const line of md.split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 6) continue;
  const chainId = Number(cells[2]);
  if (!Number.isInteger(chainId) || chainId <= 0) continue;
  const status = cells[4];
  const versions = {};
  const missing = [];
  for (const m of status.matchAll(/(✅|❌)\s*\[([A-Za-z0-9]+)(?:\s+v([0-9.]+))?\]/g)) {
    const [, mark, contract, ver] = m;
    if (mark === "✅") (versions[contract] ??= []).push(ver ?? "singleton");
    else missing.push(`${contract}${ver ? " v" + ver : ""}`);
  }
  perChain.set(chainId, { versions, missing });
}

// ---------------------------------------------------------------------------
// 3) Chainlist RPC snapshot
// ---------------------------------------------------------------------------
const mainnets = JSON.parse(readFileSync(join(mirror, "chains-mainnet.json"), "utf8"));
const testnets = JSON.parse(readFileSync(join(mirror, "chains-testnet.json"), "utf8"));
const lspChains = [...mainnets.map((c) => ({ ...c, testnet: false })), ...testnets.map((c) => ({ ...c, testnet: true }))];
const ids = new Set(lspChains.map((c) => c.chainId));

let chainlist = [];
let chainlistMeta = { url: "https://chainlist.org/rpcs.json", fetchedAt: now, ok: false };
try {
  const txt = await fetchText("https://chainlist.org/rpcs.json");
  chainlist = JSON.parse(txt);
  chainlistMeta = { ...chainlistMeta, ok: true, sha256: sha256(txt), chains: chainlist.length };
} catch (e) {
  chainlistMeta.error = String(e);
  console.warn("! chainlist unavailable:", e.message);
}
const rpcs = {};
const TEMPLATE = /\$\{|\{[A-Z_]+\}|API_KEY|INFURA|ALCHEMY/i;
for (const c of lspChains) {
  const list = [];
  const seen = new Set();
  const push = (url, source, tracking) => {
    if (!url || !/^https:\/\//.test(url) || TEMPLATE.test(url)) return;
    const u = url.replace(/\/+$/, "");
    if (seen.has(u)) return;
    seen.add(u);
    list.push({ url: u, source, tracking });
  };
  push(c.rpcUrl, "lsp-repo", "unspecified");
  const cl = chainlist.find((x) => x.chainId === c.chainId);
  const clRpcs = (cl?.rpc ?? []).map((r) => (typeof r === "string" ? { url: r, tracking: "unspecified" } : r));
  const rank = { none: 0, limited: 1, unspecified: 2, yes: 3 };
  clRpcs.sort((a, b) => (rank[a.tracking ?? "unspecified"] ?? 2) - (rank[b.tracking ?? "unspecified"] ?? 2));
  for (const r of clRpcs) push(r.url, "chainlist", r.tracking ?? "unspecified");
  rpcs[c.chainId] = list.slice(0, 8);
}
writeJson(join(reg, "rpcs.json"), { generatedAt: now, sources: { lspRepo: RAW("deployments/chains-mainnet.json"), chainlist: chainlistMeta }, rpcs });

// ---------------------------------------------------------------------------
// 4) chains.json (derived)
// ---------------------------------------------------------------------------
const explorerApi = (e) => {
  const base = e.url.replace(/\/+$/, "");
  if (e.category === "blockscout") return `${base}/api`;
  if (e.category === "etherscan") return "https://api.etherscan.io/v2/api"; // multichain V2 (needs a free key)
  if (e.category === "routescan") return undefined; // routescan API varies per network; resolved at runtime via chainid
  return undefined;
};
const relayers = {
  42: [{ name: "lukso-public", baseUrl: "https://relayer.mainnet.lukso.network/api", profile: "lukso-live" }],
  4201: [{ name: "lukso-public", baseUrl: "https://relayer.testnet.lukso.network/api", profile: "lukso-live" }],
};
const sourcifyChains = new Set([1, 10, 56, 100, 137, 8453, 42161, 43114, 11155111, 84532, 421614, 59144, 534352, 4663, 42220, 130, 81457, 5000, 1284, 1285, 324, 7777777, 34443, 480, 57073]);
const chains = lspChains.map((c) => {
  const pc = perChain.get(c.chainId) ?? { versions: {}, missing: [] };
  const deployed = Object.keys(pc.versions).includes("LSP23LinkedContractsFactory");
  return {
    chainId: c.chainId,
    name: c.name,
    slug: c.slug,
    nativeSymbol: c.currencySymbol,
    testnet: c.testnet,
    rpcs: rpcs[c.chainId].map((r) => ({ ...r, trust: r.source === "lsp-repo" ? "bundled" : "remote-unpinned" })),
    explorers: c.explorers.map((e) => ({ url: e.url.replace(/\/+$/, ""), family: ["blockscout", "etherscan", "routescan"].includes(e.category) ? e.category : "other", apiBase: explorerApi(e) })),
    bridges: c.bridges ?? [],
    lsp: { deployed, versions: pc.versions, ...(pc.missing.length ? { notes: [`not deployed: ${pc.missing.join(", ")}`] } : {}) },
    relayers: relayers[c.chainId] ?? [],
    sourcify: sourcifyChains.has(c.chainId),
    staleAfterSec: c.chainId === 1 || c.chainId === 11155111 ? 120 : 60,
    confirmations: c.chainId === 1 ? 2 : 1,
  };
});
chains.sort((a, b) => Number(a.testnet) - Number(b.testnet) || a.name.localeCompare(b.name));
writeJson(join(reg, "chains.json"), {
  generatedAt: now,
  source: { repository: `https://github.com/${REPO}`, commit: COMMIT, files: ["deployments/chains-mainnet.json", "deployments/chains-testnet.json", "deployments/DEPLOYED_CHAINS.md"] },
  counts: { total: chains.length, mainnets: chains.filter((c) => !c.testnet).length, testnets: chains.filter((c) => c.testnet).length, lspDeployed: chains.filter((c) => c.lsp.deployed).length },
  chains,
});

// ---------------------------------------------------------------------------
// 5) contracts.json (derived: canonical addresses only, no bytecode)
// ---------------------------------------------------------------------------
const canonical = {};
for (const [name, e] of Object.entries(contracts)) {
  if (e.address) canonical[name] = { type: e.type, versions: { [e.version ?? "singleton"]: { address: e.address, salt: e.salt } } };
  else if (e.versions) {
    canonical[name] = { type: e.type, versions: {} };
    const list = Array.isArray(e.versions) ? e.versions : Object.entries(e.versions).map(([v, ve]) => ({ version: v, ...ve }));
    for (const ve of list) canonical[name].versions[String(ve.version).replace(/^v/, "")] = { address: ve.address, salt: ve.salt };
  }
}
canonical.NickFactory = { type: "Singleton", versions: { singleton: { address: "0x4e59b44847b379578588920cA78FbF26c0B4956C" } }, source: "https://github.com/Arachnid/deterministic-deployment-proxy" };
writeJson(join(reg, "contracts.json"), { generatedAt: now, source: RAW("deployments/contracts.json"), note: "Same address on every chain where deployed (CREATE2). Presence per chain: chains.json lsp.versions; always verify code at runtime.", contracts: canonical });

// ---------------------------------------------------------------------------
// 6) protocols.json + sources.json
// ---------------------------------------------------------------------------
const protocols = JSON.parse(readFileSync(join(root, "build", "protocols.source.json"), "utf8"));
writeJson(join(reg, "protocols.json"), { generatedAt: now, ...protocols });
writeJson(join(reg, "sources.json"), {
  note: "Remote pointers used by `up chains refresh` and `up chains rpc find`. Remote data is labelled remote-unpinned/remote-discovered and never silently overwrites the bundled seed.",
  lspDeployments: {
    repository: `https://github.com/${REPO}/tree/main/deployments`,
    raw: {
      deployedChains: `https://raw.githubusercontent.com/${REPO}/main/deployments/DEPLOYED_CHAINS.md`,
      chainsMainnet: `https://raw.githubusercontent.com/${REPO}/main/deployments/chains-mainnet.json`,
      chainsTestnet: `https://raw.githubusercontent.com/${REPO}/main/deployments/chains-testnet.json`,
      contracts: `https://raw.githubusercontent.com/${REPO}/main/deployments/contracts.json`,
    },
    pinnedCommit: COMMIT,
  },
  rpcLists: [
    { name: "chainlist", url: "https://chainlist.org/rpcs.json", site: "https://chainlist.org", note: "DefiLlama; per-endpoint tracking label" },
    { name: "chainid.network", url: "https://chainid.network/chains.json", site: "https://github.com/ethereum-lists/chains" },
  ],
  docs: {
    lukso: "https://docs.lukso.tech",
    lips: "https://github.com/lukso-network/LIPs",
    lsp15: "https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md",
    deployments: "https://docs.lukso.tech/networks/mainnet/contracts",
  },
  abiDiscovery: {
    sourcify: "https://sourcify.dev/server/v2/contract/{chainId}/{address}?fields=abi,proxyResolution",
    etherscanV2: "https://api.etherscan.io/v2/api?chainid={chainId}&module=contract&action=getabi&address={address}&apikey={key}",
    blockscout: "{explorer}/api/v2/smart-contracts/{address}",
    fourbyteSourcify: "https://api.4byte.sourcify.dev/signature-database/v1/lookup?function={selector}&filter=false",
    fourbyteDirectory: "https://www.4byte.directory/api/v1/signatures/?hex_signature={selector}",
  },
});

const sum = JSON.parse(readFileSync(join(reg, "chains.json"), "utf8")).counts;
console.log(`registry: ${sum.total} chains (${sum.mainnets} mainnets, ${sum.testnets} testnets), ${sum.lspDeployed} with LSP23 deployed; chainlist ${chainlistMeta.ok ? "ok" : "UNAVAILABLE"}`);
