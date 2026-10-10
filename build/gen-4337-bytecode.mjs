// Generates the deploy bytecode the opt-in ERC-4337 module ships with:
//   skills/universal-profile/assets/bytecode/EntryPointV06.json
//   skills/universal-profile/assets/bytecode/Extension4337.json
// Inputs are the pinned compiled artifacts in test/fixtures/bytecode/ (written by
// build/gen-abis.mjs from a compiled lukso-network/lsp-smart-contracts checkout:
// Extension4337 from packages/lsp17-contracts, EntryPoint from its
// node_modules/@account-abstraction/contracts@0.6.0 release artifact).
//
// For each contract the file records: creation code, sha256 + keccak256 of the
// creation code, the deterministic deployment (Nick's CREATE2 factory, salt,
// init-code hash, expected address) and the keccak256 of the deployed runtime
// code. Runtime hashes are measured, not assumed: the script deploys both
// contracts through Nick's factory on an in-process EVM (Hardhat/EDR, dev only)
// and records eth_getCode hashes. The EntryPoint runtime hash is additionally
// asserted against the value observed on live chains (see LIVE_ENTRYPOINT below).
//
// Usage: node build/gen-4337-bytecode.mjs [--check]
//   --check  regenerate in memory and fail if the committed files differ.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { concat, encodeAbiParameters, getContractAddress, keccak256, toBytes, getAddress } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures", "bytecode");
const outDir = join(root, "skills", "universal-profile", "assets", "bytecode");
const check = process.argv.includes("--check");

const NICK_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const NICK_RUNTIME = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const ENTRYPOINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const ZERO_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000";
// Fixed, documented salt for Extension4337 so it lands on the same address on every
// chain for the same EntryPoint and the same bytecode.
const EXTENSION_SALT_PREIMAGE = "universal-profile-skill:Extension4337:v1";
const EXTENSION_SALT = keccak256(toBytes(EXTENSION_SALT_PREIMAGE));

// keccak256(eth_getCode(0x5FF137D4…2789)) observed on 2026-10-09 via public RPCs on
// LUKSO Testnet (4201), Ethereum (1) and Base (8453); LUKSO Mainnet (42) returned 0x.
const LIVE_ENTRYPOINT = {
  runtimeCodeHash: "0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70",
  observedOn: [4201, 1, 8453],
  observedAt: "2026-10-09",
  absentOn: [42],
};

const sha256 = (hex) => createHash("sha256").update(Buffer.from(hex.slice(2), "hex")).digest("hex");
const fixture = (n) => JSON.parse(readFileSync(join(fixtures, `${n}.json`), "utf8"));

async function measureRuntimeHashes(deployments) {
  const { network } = await import("hardhat");
  const conn = await network.connect();
  const rpc = (method, params = []) => conn.provider.request({ method, params });
  try {
    await rpc("hardhat_setCode", [NICK_FACTORY, NICK_RUNTIME]);
    const [from] = await rpc("eth_accounts");
    const out = {};
    for (const [name, d] of Object.entries(deployments)) {
      const hash = await rpc("eth_sendTransaction", [{ from, to: NICK_FACTORY, data: concat([d.salt, d.initCode]), gas: "0xE4E1C0" }]);
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (!receipt || receipt.status !== "0x1") throw new Error(`${name}: deployment through Nick's factory failed`);
      const code = await rpc("eth_getCode", [d.address, "latest"]);
      if (!code || code === "0x") throw new Error(`${name}: no code at ${d.address}`);
      out[name] = { runtimeCodeHash: keccak256(code), runtimeSize: (code.length - 2) / 2 };
    }
    return out;
  } finally {
    await conn.close?.();
  }
}

const ep = fixture("EntryPointV06");
const ext = fixture("Extension4337");
const lspProv = JSON.parse(readFileSync(join(root, "skills", "universal-profile", "assets", "abis", "PROVENANCE.json"), "utf8"));

const epInit = ep.bytecode;
const epAddress = getContractAddress({ opcode: "CREATE2", from: NICK_FACTORY, salt: ZERO_SALT, bytecode: epInit });
if (epAddress !== getAddress(ENTRYPOINT_V06)) throw new Error(`EntryPoint creation code does not produce the canonical address (${epAddress})`);

const extInit = concat([ext.bytecode, encodeAbiParameters([{ type: "address" }], [ENTRYPOINT_V06])]);
const extAddress = getContractAddress({ opcode: "CREATE2", from: NICK_FACTORY, salt: EXTENSION_SALT, bytecode: extInit });

const measured = await measureRuntimeHashes({
  EntryPointV06: { salt: ZERO_SALT, initCode: epInit, address: epAddress },
  Extension4337: { salt: EXTENSION_SALT, initCode: extInit, address: extAddress },
});
if (measured.EntryPointV06.runtimeCodeHash !== LIVE_ENTRYPOINT.runtimeCodeHash) {
  throw new Error(`EntryPoint runtime hash ${measured.EntryPointV06.runtimeCodeHash} differs from the live canonical ${LIVE_ENTRYPOINT.runtimeCodeHash}`);
}

const epDoc = {
  name: "EntryPointV06",
  contractName: "EntryPoint",
  version: "0.6.0",
  provenance: {
    package: "@account-abstraction/contracts",
    packageVersion: ep.version,
    artifact: "artifacts/EntryPoint.json (npm release artifact, as installed in the pinned lsp-smart-contracts checkout)",
    source: "https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.6.0",
    lspSmartContractsCommit: lspProv.lspSmartContracts?.commit,
  },
  creationCode: epInit,
  creationCodeSha256: sha256(epInit),
  creationCodeKeccak256: keccak256(epInit),
  constructor: [],
  deployment: {
    method: "create2-nick",
    factory: NICK_FACTORY,
    salt: ZERO_SALT,
    initCode: "creationCode",
    initCodeHash: keccak256(epInit),
    address: epAddress,
  },
  runtimeCodeHash: measured.EntryPointV06.runtimeCodeHash,
  runtimeSize: measured.EntryPointV06.runtimeSize,
  runtimeCodeHashLiveCheck: LIVE_ENTRYPOINT,
};

const extProv = lspProv.files?.["lsp/Extension4337.json"] ?? {};
const extDoc = {
  name: "Extension4337",
  contractName: "Extension4337",
  version: extProv.version ?? "unknown",
  provenance: {
    package: extProv.package ?? "@lukso/lsp17-contracts",
    packageVersion: extProv.version,
    source: "packages/lsp17-contracts/contracts/Extension4337.sol",
    repository: "https://github.com/lukso-network/lsp-smart-contracts",
    commit: lspProv.lspSmartContracts?.commit,
    compiler: "solc 0.8.17+commit.8df45f5f, optimizer enabled (runs 1000), evmVersion london",
    abi: "assets/abis/lsp/Extension4337.json",
  },
  creationCode: ext.bytecode,
  creationCodeSha256: sha256(ext.bytecode),
  creationCodeKeccak256: keccak256(ext.bytecode),
  constructor: [{ name: "entryPoint_", type: "address" }],
  deployment: {
    method: "create2-nick",
    factory: NICK_FACTORY,
    saltPreimage: EXTENSION_SALT_PREIMAGE,
    salt: EXTENSION_SALT,
    initCode: "creationCode ++ abi.encode(entryPoint)",
    note: "Same address on every chain for the same EntryPoint (CREATE2 over Nick's factory). A different EntryPoint gives a different init code and address.",
    canonical: {
      entryPoint: ENTRYPOINT_V06,
      initCodeHash: keccak256(extInit),
      address: extAddress,
      runtimeCodeHash: measured.Extension4337.runtimeCodeHash,
      runtimeSize: measured.Extension4337.runtimeSize,
    },
  },
};

const files = { "EntryPointV06.json": epDoc, "Extension4337.json": extDoc };
let drift = false;
mkdirSync(outDir, { recursive: true });
for (const [name, doc] of Object.entries(files)) {
  const txt = JSON.stringify(doc, null, 1) + "\n";
  const file = join(outDir, name);
  if (check) {
    const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (cur !== txt) {
      console.error(`drift: ${file}`);
      drift = true;
    }
  } else {
    writeFileSync(file, txt);
    console.log(`wrote ${file}`);
  }
}
console.log(`EntryPoint v0.6: ${epAddress} runtime ${measured.EntryPointV06.runtimeCodeHash}`);
console.log(`Extension4337(EntryPoint v0.6): ${extAddress} salt ${EXTENSION_SALT} runtime ${measured.Extension4337.runtimeCodeHash}`);
process.exit(drift ? 1 : 0);
