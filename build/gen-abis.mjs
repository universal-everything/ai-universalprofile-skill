// Generates skills/universal-profile/assets/abis/** (ABIs only, never bytecode):
//  - lsp/<Contract>.json  : every non-mock contract/interface/abstract of every
//                           lsp-smart-contracts package (compiled Hardhat artifacts
//                           of a pinned checkout, path via --lsp-repo or LSP_REPO)
//  - deployed/<file>.json : verbatim copies of deployments/abi/* (the ABIs of the
//                           canonical deployed implementations) — from the registry mirror
//  - reference/<Name>.json: ERC-20/721/1155/165/1271/777-hook, EntryPoint v0.6,
//                           Multicall3, Permit2 (subset), WETH9 (from viem + standards)
//  - errors.json          : union of all custom errors (for revert decoding)
//  - PROVENANCE.json      : source, version, sha256 for every file
// Also writes test fixtures (creation bytecode) to test/fixtures/bytecode/ — never shipped.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { erc20Abi, erc721Abi, erc4626Abi, multicall3Abi, parseAbi, toFunctionSelector } from "viem";
import { formatAbiItem } from "abitype";
import { entryPoint06Abi } from "viem/account-abstraction";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "skills", "universal-profile", "assets", "abis");
const fixtures = join(root, "test", "fixtures", "bytecode");
const args = process.argv.slice(2);
const LSP_REPO = args.includes("--lsp-repo") ? args[args.indexOf("--lsp-repo") + 1] : process.env.LSP_REPO;
if (!LSP_REPO || !existsSync(join(LSP_REPO, "packages"))) {
  console.error("usage: node build/gen-abis.mjs --lsp-repo <path to a compiled lukso-network/lsp-smart-contracts checkout>");
  process.exit(2);
}
const lspCommit = execSync("git rev-parse HEAD", { cwd: LSP_REPO }).toString().trim();
const sha = (s) => createHash("sha256").update(s).digest("hex");
const put = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  const txt = JSON.stringify(value, null, 1) + "\n";
  writeFileSync(file, txt);
  return txt;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(fixtures, { recursive: true });
const provenance = { generatedAt: new Date().toISOString(), lspSmartContracts: { repository: "https://github.com/lukso-network/lsp-smart-contracts", commit: lspCommit, note: "ABI surface identical to upstream main 16ab244 for the account stack (VERSION strings differ); LSP7/LSP8 0.18 deltas recorded in standards-functions (nonTransferabilityEnabled rename, burn in Mintable presets)." }, files: {} };

// --- LSP packages -----------------------------------------------------------
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const seen = new Map();
const allErrors = new Map();
const pkgVersions = {};
for (const pkg of readdirSync(join(LSP_REPO, "packages")).sort()) {
  const art = join(LSP_REPO, "packages", pkg, "artifacts", "contracts");
  if (!existsSync(art)) continue;
  const pj = join(LSP_REPO, "packages", pkg, "package.json");
  pkgVersions[pkg] = existsSync(pj) ? JSON.parse(readFileSync(pj, "utf8")).version : "unknown";
  for (const f of walk(art)) {
    if (!f.endsWith(".json") || f.endsWith(".dbg.json")) continue;
    const relp = relative(art, f);
    if (/(^|\/)(Mocks?|mocks?|Helpers|Test|test)\//.test(relp)) continue;
    const a = JSON.parse(readFileSync(f, "utf8"));
    if (!a.abi || a.abi.length === 0 || !a.contractName) continue;
    if (/Mock|Tester|Helper$/.test(a.contractName)) continue;
    for (const e of a.abi) if (e.type === "error") allErrors.set(formatAbiItem(e), e);
    const key = a.contractName;
    const doc = { contractName: a.contractName, package: `@lukso/${pkg}`, packageVersion: pkgVersions[pkg], sourceName: a.sourceName, kind: a.bytecode && a.bytecode !== "0x" ? "deployable" : "interface-or-abstract", abi: a.abi };
    if (seen.has(key)) continue; // first occurrence wins (packages sorted)
    seen.set(key, doc);
    const txt = put(join(out, "lsp", `${key}.json`), doc);
    provenance.files[`lsp/${key}.json`] = { package: doc.package, version: doc.packageVersion, source: a.sourceName, sha256: sha(txt) };
    if (doc.kind === "deployable") {
      writeFileSync(join(fixtures, `${key}.json`), JSON.stringify({ contractName: key, bytecode: a.bytecode, deployedBytecode: a.deployedBytecode, linkReferences: a.linkReferences }) + "\n");
    }
  }
}

// --- erc725 base (from the checkout's node_modules) -----------------------------
const erc725 = join(LSP_REPO, "node_modules", "@erc725", "smart-contracts", "artifacts");
if (existsSync(erc725)) {
  for (const f of walk(erc725)) {
    if (!f.endsWith(".json") || f.endsWith(".dbg.json")) continue;
    const a = JSON.parse(readFileSync(f, "utf8"));
    if (!a.abi?.length || !/^(ERC725|ERC725X|ERC725Y|ERC725Init|ERC725XInit|ERC725YInit|IERC725X|IERC725Y|OwnableUnset)$/.test(a.contractName ?? "")) continue;
    for (const e of a.abi) if (e.type === "error") allErrors.set(formatAbiItem(e), e);
    if (seen.has(a.contractName)) continue;
    const ver = JSON.parse(readFileSync(join(LSP_REPO, "node_modules", "@erc725", "smart-contracts", "package.json"), "utf8")).version;
    const doc = { contractName: a.contractName, package: "@erc725/smart-contracts", packageVersion: ver, sourceName: a.sourceName, kind: a.bytecode && a.bytecode !== "0x" ? "deployable" : "interface-or-abstract", abi: a.abi };
    seen.set(a.contractName, doc);
    const txt = put(join(out, "lsp", `${a.contractName}.json`), doc);
    provenance.files[`lsp/${a.contractName}.json`] = { package: doc.package, version: ver, sha256: sha(txt) };
  }
}

// --- EntryPoint v0.6 creation code fixture (account-abstraction 0.6.0) -----------
const epArt = join(LSP_REPO, "node_modules", "@account-abstraction", "contracts", "artifacts", "EntryPoint.json");
if (existsSync(epArt)) {
  const a = JSON.parse(readFileSync(epArt, "utf8"));
  writeFileSync(join(fixtures, "EntryPointV06.json"), JSON.stringify({ contractName: "EntryPoint", version: "0.6.0", bytecode: a.bytecode, deployedBytecode: a.deployedBytecode }) + "\n");
}

// --- deployed ABIs (verbatim from registry mirror) -------------------------------
const mirrorAbi = join(root, "skills", "universal-profile", "assets", "registry", "lsp-deployments", "abi");
if (existsSync(mirrorAbi)) {
  for (const n of readdirSync(mirrorAbi)) {
    mkdirSync(join(out, "deployed"), { recursive: true });
    copyFileSync(join(mirrorAbi, n), join(out, "deployed", n));
    provenance.files[`deployed/${n}`] = { source: "lsp-smart-contracts deployments/abi (pinned commit, see registry/lsp-deployments/PROVENANCE.json)", sha256: sha(readFileSync(join(mirrorAbi, n))) };
  }
}

// --- reference standards ------------------------------------------------------------
const ref = {
  ERC20: { abi: [...erc20Abi, ...parseAbi(["function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)", "function nonces(address owner) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)"])], source: "EIP-20 + EIP-2612 (viem erc20Abi + permit)" },
  ERC721: { abi: [...erc721Abi, ...parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)", "function totalSupply() view returns (uint256)", "function tokenByIndex(uint256 index) view returns (uint256)", "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)"])], source: "EIP-721 (+Metadata, +Enumerable)" },
  ERC1155: {
    abi: parseAbi([
      "function balanceOf(address account, uint256 id) view returns (uint256)",
      "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
      "function setApprovalForAll(address operator, bool approved)",
      "function isApprovedForAll(address account, address operator) view returns (bool)",
      "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
      "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)",
      "function uri(uint256 id) view returns (string)",
      "function supportsInterface(bytes4 interfaceId) view returns (bool)",
      "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
      "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
      "event ApprovalForAll(address indexed account, address indexed operator, bool approved)",
      "event URI(string value, uint256 indexed id)",
    ]),
    source: "EIP-1155 (+MetadataURI)",
  },
  ERC165: { abi: parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]), source: "EIP-165" },
  ERC1271: { abi: parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4 magicValue)"]), source: "EIP-1271" },
  ERC4626: { abi: erc4626Abi, source: "EIP-4626 (viem)" },
  Multicall3: { abi: multicall3Abi, source: "https://github.com/mds1/multicall3 (viem multicall3Abi)" },
  EntryPointV06: { abi: entryPoint06Abi, source: "eth-infinitism/account-abstraction v0.6.0 (viem entryPoint06Abi)" },
  WETH9: {
    abi: parseAbi(["function deposit() payable", "function withdraw(uint256 wad)", "function balanceOf(address) view returns (uint256)", "function approve(address guy, uint256 wad) returns (bool)", "function transfer(address dst, uint256 wad) returns (bool)", "function transferFrom(address src, address dst, uint256 wad) returns (bool)", "function allowance(address, address) view returns (uint256)", "function totalSupply() view returns (uint256)", "event Deposit(address indexed dst, uint256 wad)", "event Withdrawal(address indexed src, uint256 wad)"]),
    source: "WETH9 canonical source",
  },
  Permit2: {
    abi: parseAbi([
      "function approve(address token, address spender, uint160 amount, uint48 expiration)",
      "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
      "function transferFrom(address from, address to, uint160 amount, address token)",
      "function invalidateNonces(address token, address spender, uint48 newNonce)",
      "function lockdown((address token, address spender)[] approvals)",
      "function nonceBitmap(address, uint256) view returns (uint256)",
      "function DOMAIN_SEPARATOR() view returns (bytes32)",
    ]),
    source: "Uniswap Permit2 (subset: allowance transfer)",
  },
  HyperlaneTokenRouter: {
    abi: parseAbi(["function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32 messageId)", "function quoteGasPayment(uint32 destinationDomain) view returns (uint256)", "function quoteTransferRemote(uint32 destination, bytes32 recipient, uint256 amount) view returns ((address token, uint256 amount)[] quotes)", "function wrappedToken() view returns (address)", "function balanceOf(address) view returns (uint256)"]),
    source: "Hyperlane TokenRouter (warp routes)",
  },
  CoWSettlement: { abi: parseAbi(["function setPreSignature(bytes orderUid, bool signed)", "function preSignature(bytes) view returns (uint256)", "function domainSeparator() view returns (bytes32)", "function filledAmount(bytes) view returns (uint256)", "function invalidateOrder(bytes orderUid)"]), source: "CoW Protocol GPv2Settlement (subset)" },
};
for (const [name, { abi, source }] of Object.entries(ref)) {
  for (const e of abi) if (e.type === "error") allErrors.set(formatAbiItem(e), e);
  const txt = put(join(out, "reference", `${name}.json`), { contractName: name, source, abi });
  provenance.files[`reference/${name}.json`] = { source, sha256: sha(txt) };
}

// --- errors union + selector index ---------------------------------------------------
const errors = [...allErrors.values()];
put(join(out, "errors.json"), errors);
const selectors = {};
for (const doc of seen.values()) {
  for (const e of doc.abi) {
    if (e.type === "function") (selectors[toFunctionSelector(e)] ??= new Set()).add(formatAbiItem(e).replace(/^function /, ""));
  }
}
const selOut = Object.fromEntries(Object.entries(selectors).map(([k, v]) => [k, [...v]]));
put(join(out, "selectors.json"), selOut);
writeFileSync(join(out, "PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");
console.log(`abis: ${seen.size} LSP/ERC725 contracts, ${Object.keys(ref).length} reference, ${errors.length} errors, ${Object.keys(selOut).length} selectors; lsp commit ${lspCommit.slice(0, 10)}`);
