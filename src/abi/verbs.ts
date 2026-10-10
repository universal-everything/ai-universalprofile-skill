// ABI, generic-contract and protocol-knowledge verbs.
//   abi encode | decode | decode-error | decode-event | fetch | functions | resolve-proxy | selector | bundled
//   contract read | call
//   protocols list | verify
import type { Abi, AbiEvent, AbiFunction, Hex } from "viem";
import type { TrustLabel, VerbContext } from "../core/types.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import { checksum } from "../core/context.ts";
import { ERROR_ABIS } from "../chain/error-abis.ts";
import { bundledCatalog, bundledIndexes, canonicalContracts } from "./bundled.ts";
import {
  decodeCalldata,
  decodeErrorData,
  decodeLog,
  decodeParams,
  decodeReturn,
  encodeCall,
  encodeParams,
  functionsOf,
  parseAbiInput,
  parseFragments,
  requireHex,
  resolveFunction,
  type DecodedCall,
  type DecodedEvent,
} from "./codec.ts";
import { abiCacheFile, discoverAbi, isSignableTrust, type AbiRecord } from "./discovery.ts";
import { lookupSelector, normalizeQuery, type SelectorCandidate, type SelectorLookup } from "./selectors.ts";
import { canonicalSignature, humanSignature, isReadOnly, selectorOf, selectorOfSignature, topicOfSignature } from "./signature.ts";
import { detectStandards } from "./detect.ts";
import { lsp17Extensions, resolveProxy, WELL_KNOWN_EXTENSION_SELECTORS } from "./proxy.ts";
import { ethCall, getCode } from "./read.ts";
import { enforceTrustPolicy, EXEC_PARAMS, parseNativeValue, resolveCall, runAsProfile } from "./contract.ts";
import { getProtocol, listIndexers, listProtocols, protocolsMeta, verifyProtocol } from "./protocols.ts";

/** Resolves --chain (or the configured default) after the config is loaded. */
export async function chainOf(ctx: VerbContext, a: Record<string, any>): Promise<number> {
  await ctx.config();
  return ctx.chainId(a.chain);
}

const ABI_PARAM = {
  name: "abi",
  type: "json" as const,
  description: "ABI to use: bundled contract name (e.g. LSP7DigitalAsset, ERC20), JSON ABI, path to a .json ABI file, or human-readable fragments.",
};
const OFFLINE_PARAM = { name: "offline", type: "boolean" as const, description: "Do not contact explorers or selector databases (bundled data + RPC only)." };

function trustNote(t: TrustLabel | "unknown"): string {
  return isSignableTrust(t as TrustLabel) ? `trust: ${t}` : `trust: ${t} ⚠ unverified`;
}

function sourceTrust(source: string): string {
  return source.startsWith("bundled") ? "bundled" : source.split(":")[0];
}

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

defineVerb({
  name: "abi encode",
  group: "abi",
  summary: "Encode calldata from a function signature/name + JSON args (or bare parameters with --types).",
  description:
    'Arguments are a JSON array (positional) or object (by parameter name). Integers accept numbers, decimal/hex strings, "1.5e18" or "<n> ether|gwei|wei"; addresses are checksum-validated; bytes are 0x-hex; tuples are arrays or objects. Without --abi the function must be a full signature.',
  risk: "local",
  params: [
    { name: "fn", type: "string", description: 'Function: full signature ("transfer(address,uint256)" or "function transfer(address to, uint256 amount)") or a name found in --abi.', positional: 0 },
    { name: "args", type: "json", description: "JSON array or object of arguments." },
    ABI_PARAM,
    { name: "types", type: "string", description: 'Encode bare ABI parameters instead of a call, e.g. "address,uint256" or "(address to, uint256 amount)[]".' },
  ],
  examples: [
    'up abi encode "transfer(address,uint256)" --args \'["0x…", "1000000"]\'',
    'up abi encode authorizeOperator --abi LSP7DigitalAsset --args \'{"operator":"0x…","amount":"5e18","operatorNotificationData":"0x"}\'',
    'up abi encode --types "bytes4,uint128" --args \'["0xc52d6008", 3]\'',
  ],
  async run(_ctx, a) {
    if (a.types) {
      const r = encodeParams(a.types, a.args);
      return { data: { mode: "parameters", types: a.types, encoded: r.data, params: r.params }, text: r.data };
    }
    if (!a.fn) throw new UpError("BAD_ARGS", "pass a function (positional) or --types");
    const src = a.abi !== undefined ? parseAbiInput(a.abi) : { abi: [] as Abi, source: "signature", trust: "user" as TrustLabel };
    const { fn } = resolveFunction(src.abi, a.fn, Array.isArray(a.args) ? a.args.length : undefined, a.abi === undefined);
    const enc = encodeCall(fn, a.args);
    return {
      data: { mode: "call", ...enc, abiSource: src.source, trust: src.trust },
      text: `${enc.description}\nselector ${enc.selector}  ${enc.signature}\n${enc.data}`,
    };
  },
});

async function optionalDiscovery(ctx: VerbContext, a: Record<string, any>): Promise<{ abi: Abi; source: string }[]> {
  if (!a.address) return [];
  const chainId = await chainOf(ctx, a);
  try {
    const rec = await discoverAbi(ctx, chainId, checksum(a.address), { offline: a.offline });
    return [{ abi: rec.abi, source: `${rec.trust}:${rec.source}` }];
  } catch (e) {
    if ((e as UpError).code === "ABI_NOT_FOUND") return [];
    throw e;
  }
}

async function remoteFunctionDecodes(data: Hex): Promise<{ decoded: DecodedCall[]; lookup: SelectorLookup }> {
  const lookup = await lookupSelector(data.slice(0, 10), {});
  const decoded: DecodedCall[] = [];
  for (const c of lookup.candidates.filter((x) => x.source !== "bundled" && x.hashMatches)) {
    try {
      const d = decodeCalldata(data, [{ abi: parseFragments(c.signature), source: c.source }]);
      if (d) decoded.push(d);
    } catch {}
  }
  return { decoded, lookup };
}

defineVerb({
  name: "abi decode",
  group: "abi",
  summary: "Decode calldata (default), return data (--fn) or bare parameters (--types); unknown selectors are looked up and labelled as guesses.",
  risk: "read",
  params: [
    { name: "data", type: "string", description: "0x-hex calldata / return data.", positional: 0, required: true },
    ABI_PARAM,
    { name: "fn", type: "string", description: "Decode as the return data of this function (name in --abi, or a full signature with returns)." },
    { name: "types", type: "string", description: 'Decode as bare parameters, e.g. "address,uint256".' },
    { name: "address", type: "string", description: "Contract the calldata targets: its ABI is discovered (trust ladder) and used first." },
    OFFLINE_PARAM,
  ],
  async run(ctx, a) {
    const data = requireHex(a.data, "data");
    if (a.types) {
      const params = decodeParams(a.types, data);
      return { data: { mode: "parameters", types: a.types, params }, text: params.map((p) => `${p.name} (${p.type}): ${JSON.stringify(p.value)}`).join("\n") };
    }
    if (a.fn) {
      const src = a.abi !== undefined ? parseAbiInput(a.abi) : { abi: [] as Abi, source: "signature" };
      const { fn } = resolveFunction(src.abi, a.fn, undefined, a.abi === undefined);
      if (!fn.outputs?.length) throw new UpError("BAD_ARGS", `${canonicalSignature(fn)} declares no outputs`, { hint: 'include them, e.g. "function balanceOf(address) view returns (uint256)"' });
      const outputs = decodeReturn(fn, data);
      return { data: { mode: "return", function: humanSignature(fn), outputs }, text: outputs.map((p) => `${p.name} (${p.type}): ${JSON.stringify(p.value)}`).join("\n") };
    }
    const cands: { abi: Abi; source: string }[] = [];
    if (a.abi !== undefined) {
      const s = parseAbiInput(a.abi);
      cands.push({ abi: s.abi, source: s.source });
    }
    cands.push(...(await optionalDiscovery(ctx, a)));
    const selector = data.slice(0, 10).toLowerCase() as Hex;
    for (const x of bundledIndexes().functions.get(selector) ?? []) cands.push({ abi: [x.item], source: `bundled:${x.contracts.slice(0, 4).join(",")}` });
    const primary = decodeCalldata(data, cands);
    if (primary) {
      return {
        data: { mode: "calldata", trust: sourceTrust(primary.source), decoded: primary },
        text: `${primary.description}\n${primary.fragment}  [${primary.source}]`,
        warnings: primary.exact ? undefined : ["re-encoding the decoded arguments does not reproduce the input exactly (extra or non-canonical bytes)"],
      };
    }
    if (a.offline) throw new UpError("ABI_NOT_FOUND", `no bundled/provided ABI decodes selector ${selector}`, { hint: "retry without --offline to query selector databases, or pass --abi" });
    const remote = await remoteFunctionDecodes(data);
    if (remote.decoded.length === 0) throw new UpError("ABI_NOT_FOUND", `no known function decodes selector ${selector}`, { hint: "pass the ABI with --abi or --address", details: { lookup: remote.lookup } });
    return {
      data: { mode: "calldata", trust: "guessed", decoded: remote.decoded[0], alternatives: remote.decoded.slice(1), lookup: remote.lookup },
      text: [`GUESSED (selector database): ${remote.decoded[0].description}`, ...remote.decoded.slice(1).map((d) => `  alternative: ${d.description}`)].join("\n"),
      warnings: ["decoded with a selector-database guess: the function identity is unverified (selector collisions exist)"],
    };
  },
});

defineVerb({
  name: "abi decode-error",
  group: "abi",
  summary: "Decode revert data: --abi, the target's ABI, all bundled LSP/ERC custom errors, Error(string), Panic(uint256), then selector databases.",
  risk: "read",
  params: [
    { name: "data", type: "string", description: "0x-hex revert data.", positional: 0, required: true },
    ABI_PARAM,
    { name: "address", type: "string", description: "Contract that reverted (its ABI is discovered and used)." },
    OFFLINE_PARAM,
  ],
  async run(ctx, a) {
    const data = requireHex(a.data, "data");
    if (data === "0x") return { data: { decoded: null, message: "reverted without data (no reason string, out of gas, or a bare revert)" }, text: "reverted without data" };
    const cands: { abi: Abi; source: string }[] = [];
    if (a.abi !== undefined) {
      const s = parseAbiInput(a.abi);
      cands.push({ abi: s.abi, source: s.source });
    }
    cands.push(...(await optionalDiscovery(ctx, a)));
    cands.push(...ERROR_ABIS.map((abi) => ({ abi, source: "bundled" })));
    for (const x of bundledIndexes().errors.get(data.slice(0, 10).toLowerCase()) ?? []) cands.push({ abi: [x.item], source: `bundled:${x.contracts.slice(0, 4).join(",")}` });
    const d = decodeErrorData(data, cands);
    if (d) return { data: { trust: sourceTrust(d.source), decoded: d }, text: `${d.message}  [${d.source}]` };
    if (!a.offline) {
      const lookup = await lookupSelector(data.slice(0, 10), {});
      for (const c of lookup.candidates.filter((x) => x.hashMatches)) {
        try {
          const g = decodeErrorData(data, [{ abi: parseFragments(`error ${c.signature}`), source: c.source }]);
          if (g) return { data: { trust: "guessed", decoded: g, lookup }, text: `GUESSED: ${g.message}`, warnings: ["error identified from a selector-database guess"] };
        } catch {}
      }
    }
    throw new UpError("ABI_NOT_FOUND", `unknown error selector ${data.slice(0, 10)}`, { hint: "pass the contract ABI with --abi or --address" });
  },
});

/** Event variants with `count` indexed inputs (remote signatures carry no indexed flags). */
function indexedVariants(ev: AbiEvent, count: number): AbiEvent[] {
  const out: AbiEvent[] = [];
  const rec = (start: number, chosen: number[]) => {
    if (out.length >= 64) return;
    if (chosen.length === count) {
      out.push({ ...ev, inputs: ev.inputs.map((i, k) => ({ ...i, indexed: chosen.includes(k) })) } as AbiEvent);
      return;
    }
    for (let k = start; k < ev.inputs.length; k++) rec(k + 1, [...chosen, k]);
  };
  rec(0, []);
  return out;
}

defineVerb({
  name: "abi decode-event",
  group: "abi",
  summary: "Decode an event log from topics + data (--abi, the emitter's ABI, bundled events, then selector databases).",
  risk: "read",
  params: [
    { name: "topics", type: "string[]", description: "Log topics (topic0 first), comma-separated or repeated.", required: true },
    { name: "data", type: "string", description: "Log data (0x-hex).", default: "0x" },
    ABI_PARAM,
    { name: "address", type: "string", description: "Emitting contract (its ABI is discovered and used first)." },
    OFFLINE_PARAM,
  ],
  async run(ctx, a) {
    const topics = (a.topics as string[]).map((t, i) => {
      const h = requireHex(t, `topics[${i}]`);
      if (h.length !== 66) throw new UpError("BAD_ARGS", `topics[${i}] must be 32 bytes`);
      return h;
    });
    if (topics.length === 0) throw new UpError("BAD_ARGS", "at least topic0 is required");
    const data = requireHex(a.data ?? "0x", "data");
    const cands: { abi: Abi; source: string }[] = [];
    if (a.abi !== undefined) {
      const s = parseAbiInput(a.abi);
      cands.push({ abi: s.abi, source: s.source });
    }
    cands.push(...(await optionalDiscovery(ctx, a)));
    for (const x of bundledIndexes().events.get(topics[0]) ?? []) cands.push({ abi: [x.item], source: `bundled:${x.contracts.slice(0, 4).join(",")}` });
    const d = decodeLog(topics, data, cands);
    if (d) return { data: { trust: sourceTrust(d.source), decoded: d }, text: `${d.description}\n${d.fragment}  [${d.source}]` };
    if (!a.offline) {
      const lookup = await lookupSelector(topics[0], {});
      const found: DecodedEvent[] = [];
      for (const c of lookup.candidates.filter((x) => x.hashMatches && x.source !== "bundled")) {
        try {
          const ev = parseFragments(`event ${c.signature}`)[0] as AbiEvent;
          const g = decodeLog(topics, data, indexedVariants(ev, topics.length - 1).map((v) => ({ abi: [v] as Abi, source: c.source })));
          if (g) found.push(g);
        } catch {}
      }
      if (found.length) {
        return {
          data: { trust: "guessed", decoded: found[0], alternatives: found.slice(1), lookup },
          text: `GUESSED: ${found[0].description}`,
          warnings: ["event identified from a selector-database guess; which parameters are indexed was inferred"],
        };
      }
    }
    throw new UpError("ABI_NOT_FOUND", `unknown event topic ${topics[0]}`, { hint: "pass the emitter ABI with --abi or --address" });
  },
});

// ---------------------------------------------------------------------------
// discovery verbs
// ---------------------------------------------------------------------------

function summarize(rec: AbiRecord) {
  const fns = functionsOf(rec.abi);
  return {
    chainId: rec.chainId,
    address: rec.address,
    name: rec.name,
    trust: rec.trust,
    signable: isSignableTrust(rec.trust),
    source: rec.source,
    fetchedAt: rec.fetchedAt,
    cached: !!rec.cached,
    standards: rec.standards,
    counts: {
      functions: fns.length,
      read: fns.filter(isReadOnly).length,
      write: fns.filter((f) => !isReadOnly(f)).length,
      events: rec.abi.filter((x) => x.type === "event").length,
      errors: rec.abi.filter((x) => x.type === "error").length,
    },
    proxy: rec.proxy,
    extensions: rec.extensions,
    attempts: rec.attempts,
    notes: rec.notes,
  };
}

defineVerb({
  name: "abi fetch",
  group: "abi",
  summary: "Discover a contract's ABI via the trust ladder (bundled → Sourcify/Blockscout/Etherscan/Routescan per chain → ERC-165 → proxy → selector guesses); prints source + trust label.",
  description:
    "The explorer family is chosen per chain from the registry. Results are cached under $UP_HOME/cache/abi/<chainId>/ with trust label, source and code hash. Value-moving calls need trust bundled/onchain/exact/partial/proxy, or a human approval.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Contract address.", positional: 0, required: true },
    { name: "full", type: "boolean", description: "Include the full ABI JSON in the result." },
    { name: "refresh", type: "boolean", description: "Ignore the cache." },
    OFFLINE_PARAM,
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const rec = await discoverAbi(ctx, chainId, checksum(a.address), { offline: a.offline, refresh: a.refresh });
    const s = summarize(rec);
    return {
      data: { ...s, cacheFile: abiCacheFile(ctx.home, chainId, rec.address), ...(a.full ? { abi: rec.abi } : {}), ...(rec.guesses ? { guesses: rec.guesses } : {}) },
      text: [
        `${rec.address} on chain ${chainId}: ${rec.name ?? "(unnamed)"}`,
        `${trustNote(rec.trust)} — source ${rec.source}${rec.cached ? " (cached)" : ""}`,
        `${s.counts.functions} functions (${s.counts.read} read, ${s.counts.write} write), ${s.counts.events} events, ${s.counts.errors} errors`,
        ...(rec.proxy?.isProxy ? [`proxy (${rec.proxy.kind}) → ${rec.proxy.implementation ?? "?"}`] : []),
        ...(rec.extensions?.length ? [`LSP17 extensions: ${rec.extensions.map((x) => `${x.signature ?? x.selector} → ${x.extension}`).join("; ")}`] : []),
        ...rec.notes.map((n) => `· ${n}`),
      ].join("\n"),
      warnings: isSignableTrust(rec.trust) ? undefined : ["this ABI is not verified: value-moving calls require a human --approval"],
    };
  },
});

defineVerb({
  name: "abi functions",
  group: "abi",
  summary: "List a contract's callable functions with mutability (read/write/payable) and the ABI trust label — explain an unknown contract before acting.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Contract address.", positional: 0, required: true },
    { name: "refresh", type: "boolean", description: "Ignore the cache." },
    OFFLINE_PARAM,
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const rec = await discoverAbi(ctx, chainId, checksum(a.address), { offline: a.offline, refresh: a.refresh });
    const fns = functionsOf(rec.abi)
      .map((f) => {
        const sel = selectorOf(f);
        const cands: SelectorCandidate[] | undefined = rec.trust === "guessed" ? rec.guesses?.[sel] : undefined;
        return {
          selector: sel,
          signature: canonicalSignature(f),
          fragment: humanSignature(f),
          mutability: f.stateMutability ?? "nonpayable",
          kind: isReadOnly(f) ? "read" : f.stateMutability === "payable" ? "payable" : "write",
          ...(cands ? { candidates: cands.map((c) => c.signature) } : {}),
        };
      })
      .sort((x, y) => x.kind.localeCompare(y.kind) || x.signature.localeCompare(y.signature));
    const unknown = rec.guesses ? Object.entries(rec.guesses).filter(([, c]) => c.length === 0).map(([s]) => s) : [];
    const events = rec.abi.filter((x): x is AbiEvent => x.type === "event").map(humanSignature);
    return {
      data: { address: rec.address, chainId, name: rec.name, trust: rec.trust, source: rec.source, standards: rec.standards, functions: fns, unknownSelectors: unknown, events },
      text: [
        `${rec.address} (${rec.name ?? "unnamed"}) — ${trustNote(rec.trust)}, source ${rec.source}`,
        ...["read", "write", "payable"].flatMap((k) => {
          const l = fns.filter((f) => f.kind === k);
          return l.length ? [`${k}:`, ...l.map((f) => `  ${f.selector}  ${f.fragment}`)] : [];
        }),
        ...(unknown.length ? [`unknown selectors: ${unknown.join(", ")}`] : []),
      ].join("\n"),
      warnings: rec.trust === "guessed" ? ["function names are guesses from selector databases; state mutability is unknown for guessed functions"] : undefined,
    };
  },
});

defineVerb({
  name: "abi resolve-proxy",
  group: "abi",
  summary: "Resolve proxies (EIP-1967 impl/beacon/admin, ERC-1167, ERC-1822) and list LSP17 extensions of ERC725 accounts.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Contract address.", positional: 0, required: true },
    { name: "selectors", type: "string[]", description: "Extra 4-byte selectors to probe for LSP17 extensions (well-known ones are always probed)." },
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const address = checksum(a.address);
    const code = await getCode(ctx, chainId, address);
    if (code === "0x") throw new UpError("ABI_NOT_FOUND", `no contract code at ${address} on chain ${chainId}`);
    const proxy = await resolveProxy(ctx, chainId, address, code);
    const implCanon = proxy.implementation ? canonicalContracts().get(proxy.implementation.toLowerCase()) : undefined;
    const det = await detectStandards(ctx, chainId, address, code);
    let extensions: { selector: Hex; extension: string; forwardsValue: boolean; knownAs?: string; signature?: string }[] | undefined;
    if (det.interfaces.ERC725Y || det.interfaces.LSP0ERC725Account) {
      const extra = ((a.selectors as string[] | undefined) ?? []).map((s) => {
        if (!/^0x[0-9a-fA-F]{8}$/.test(s)) throw new UpError("BAD_ARGS", `invalid selector ${s}`);
        return s.toLowerCase() as Hex;
      });
      const exts = await lsp17Extensions(ctx, chainId, address, [...WELL_KNOWN_EXTENSION_SELECTORS.map((x) => x.selector), ...extra]);
      extensions = exts.map((x) => {
        const canon = canonicalContracts().get(x.extension.toLowerCase());
        return { ...x, knownAs: canon?.name, signature: WELL_KNOWN_EXTENSION_SELECTORS.find((w) => w.selector === x.selector)?.signature };
      });
    }
    const implName = implCanon ? `${implCanon.name}${implCanon.version ? `@${implCanon.version}` : ""}` : undefined;
    return {
      data: { address, chainId, ...proxy, implementationKnownAs: implName, standards: det.standards, lsp17Extensions: extensions },
      text: [
        proxy.isProxy ? `${address} is a ${proxy.kind} proxy → ${proxy.implementation ?? "(implementation unresolved)"}${implName ? ` (canonical ${implName})` : ""}` : `${address} is not a recognised proxy`,
        ...proxy.evidence.map((e) => `· ${e}`),
        ...(extensions ? [`LSP17 extensions: ${extensions.length ? extensions.map((x) => `${x.signature ?? x.selector} → ${x.extension}${x.knownAs ? ` (${x.knownAs})` : ""}`).join("; ") : "none of the probed selectors"}`] : []),
      ].join("\n"),
    };
  },
});

defineVerb({
  name: "abi selector",
  group: "abi",
  summary: "Signature → selector + event topic, or 0x selector/topic → ALL candidate signatures (bundled → Sourcify 4byte → 4byte.directory).",
  risk: "read",
  params: [
    { name: "query", type: "string", description: 'A signature ("transfer(address,uint256)") or a 4-byte selector / 32-byte topic.', positional: 0, required: true },
    { name: "all-sources", type: "boolean", description: "Query every database even after a hit (shows all collisions)." },
    OFFLINE_PARAM,
  ],
  async run(_ctx, a) {
    const q = String(a.query).trim();
    if (q.includes("(")) {
      const item = parseFragments(q)[0];
      if (item.type !== "function" && item.type !== "event" && item.type !== "error") throw new UpError("BAD_ARGS", "expected a function, event or error signature");
      const sig = canonicalSignature(item as AbiFunction);
      const selector = selectorOfSignature(sig);
      const topic = topicOfSignature(sig);
      const idx = bundledIndexes();
      const known = [...new Set([...(idx.functions.get(selector) ?? []), ...(idx.errors.get(selector) ?? []), ...(idx.events.get(topic) ?? [])].flatMap((x) => x.contracts))];
      return {
        data: { signature: sig, selector, topic, bundledIn: known },
        text: `${sig}\nselector ${selector}\nevent topic ${topic}${known.length ? `\nbundled in: ${known.slice(0, 12).join(", ")}${known.length > 12 ? ", …" : ""}` : ""}`,
      };
    }
    normalizeQuery(q);
    const r = await lookupSelector(q, { offline: a.offline, allSources: a["all-sources"] });
    return {
      data: r,
      text: r.candidates.length
        ? [
            `${r.query} (${r.trust}):`,
            ...r.candidates.map((c) => `  ${c.signature}  [${c.source}${c.contracts ? `: ${c.contracts.slice(0, 3).join(", ")}` : ""}${c.filtered ? ", filtered" : ""}${c.hashMatches ? "" : ", HASH MISMATCH"}]`),
          ].join("\n")
        : `${r.query}: no candidates (${r.sources.map((s) => `${s.source}: ${s.outcome}`).join("; ")})`,
      warnings: r.warnings.length ? r.warnings : undefined,
    };
  },
});

defineVerb({
  name: "abi bundled",
  group: "abi",
  summary: "List the bundled, pinned ABIs (names usable with --abi).",
  risk: "local",
  params: [{ name: "filter", type: "string", description: "Substring filter.", positional: 0 }],
  async run(_ctx, a) {
    const list = [...bundledCatalog().values()]
      .filter((e) => !a.filter || e.name.toLowerCase().includes(String(a.filter).toLowerCase()))
      .map((e) => ({ name: e.name, group: e.group, package: e.package, version: e.version }));
    return { data: { count: list.length, abis: list }, text: list.map((e) => `${e.name.padEnd(48)} ${e.group}${e.package ? ` ${e.package}@${e.version}` : e.version ? ` v${e.version}` : ""}`).join("\n") };
  },
});

// ---------------------------------------------------------------------------
// contract read / call
// ---------------------------------------------------------------------------

const CALL_PARAMS = [
  { name: "address", type: "string" as const, description: "Target contract.", positional: 0, required: true },
  { name: "fn", type: "string" as const, description: "Function name (from the discovered ABI / --abi) or full signature.", required: true },
  { name: "args", type: "json" as const, description: "JSON array or object of arguments." },
  ABI_PARAM,
  OFFLINE_PARAM,
];

defineVerb({
  name: "contract read",
  group: "abi",
  summary: "Call a view function (eth_call) on any contract using the discovered ABI; read-only, never sends.",
  risk: "read",
  params: [
    ...CALL_PARAMS,
    { name: "from", type: "string", description: 'msg.sender for the call (address, or "profile" for the active Universal Profile).' },
    { name: "block", type: "string", description: "Block number (decimal/hex) or tag (latest, safe, finalized).", default: "latest" },
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const target = checksum(a.address);
    const call = await resolveCall(ctx, chainId, target, { fn: a.fn, args: a.args, abi: a.abi, offline: a.offline });
    const from = a.from === "profile" ? await ctx.profile(a.profile, chainId) : a.from ? checksum(a.from) : undefined;
    const block = /^\d+$/.test(String(a.block)) ? `0x${BigInt(a.block).toString(16)}` : String(a.block);
    let raw: Hex;
    try {
      raw = await ethCall(ctx, chainId, target, call.encoded.data, { from, block });
    } catch (e) {
      throw new UpError("SIMULATION_REVERTED", `${call.encoded.signature} reverted: ${(e as Error).message}`, { details: { calldata: call.encoded.data } });
    }
    const warnings = [...call.warnings];
    if (!call.readOnly) warnings.push(`${call.encoded.signature} is ${call.fn.stateMutability ?? "nonpayable"}: this was only a simulation (eth_call); nothing was sent`);
    const outputs = call.fn.outputs?.length ? decodeReturn(call.fn, raw) : undefined;
    return {
      data: { chainId, target, function: call.encoded.fragment, args: call.encoded.args, trust: call.trust, abiSource: call.source, block, outputs, raw },
      text: `${call.encoded.description} → ${outputs ? outputs.map((o) => `${o.name}: ${JSON.stringify(o.value)}`).join(", ") : raw}\n${trustNote(call.trust)} (${call.source})`,
      warnings: warnings.length ? warnings : undefined,
    };
  },
});

defineVerb({
  name: "contract call",
  group: "abi",
  summary: "Call a state-changing function on any contract AS THE PROFILE (ERC725X CALL via the chosen execution path); the decoded call is shown before consent.",
  description:
    "Value-moving calls (native --value, transfer/approve/operator/setData/execute/ownership …) need an ABI with trust bundled/onchain/exact/partial/proxy; with a caller-supplied ABI, a bare signature or a selector guess the human must approve (--approval). Use --dry-run to see the confirmation without sending.",
  risk: "write",
  params: [...CALL_PARAMS, { name: "value", type: "string", description: 'Native value sent with the call, in native units ("0.01") or with a unit ("1000 wei", "2 gwei").' }, ...EXEC_PARAMS],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const profile = await ctx.profile(a.profile, chainId);
    const target = checksum(a.address);
    const value = parseNativeValue(a.value);
    const call = await resolveCall(ctx, chainId, target, { fn: a.fn, args: a.args, abi: a.abi, offline: a.offline });
    if (call.readOnly) throw new UpError("BAD_ARGS", `${call.encoded.signature} is ${call.fn.stateMutability}; nothing to send`, { hint: `use: up contract read ${target} --fn ${a.fn}` });
    if (value > 0n && call.trust !== "guessed" && call.fn.stateMutability !== "payable") {
      throw new UpError("BAD_ARGS", `${call.encoded.signature} is not payable but --value is ${value} wei`);
    }
    const policy = enforceTrustPolicy(ctx, call, value, { to: target, data: call.encoded.data });
    let symbol = "native";
    try {
      symbol = ctx.registry.chain(chainId).nativeSymbol;
    } catch {}
    const description = `${target}.${call.encoded.description}${value > 0n ? ` with ${value} wei (${symbol})` : ""} [ABI ${call.trust} via ${call.source}${policy.requiresApproval ? "; human approval required" : ""}]`;
    const outcome = await runAsProfile(ctx, { chainId, profile, calls: [{ operation: 0, to: target, value, data: call.encoded.data }], description }, a);
    const warnings = [...call.warnings, ...(outcome.warnings ?? []), ...(policy.requiresApproval && ctx.flags.dryRun ? [`a real run needs --approval: ${policy.reason}`] : [])];
    return {
      data: {
        chainId,
        profile,
        target,
        function: call.encoded.fragment,
        signature: call.encoded.signature,
        args: call.encoded.args,
        value: value.toString(),
        calldata: call.encoded.data,
        trust: call.trust,
        abiSource: call.source,
        approvalRequired: policy.requiresApproval,
        approvalReason: policy.reason,
        outcome,
      },
      text: `${outcome.status}: ${description}${outcome.txHash ? `\ntx ${outcome.txHash}` : ""}${outcome.explorerUrl ? `\n${outcome.explorerUrl}` : ""}`,
      warnings: warnings.length ? warnings : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// protocols
// ---------------------------------------------------------------------------

defineVerb({
  name: "protocols list",
  group: "knowledge",
  summary: "Well-known protocol addresses (Multicall3, Permit2, LSP26, EntryPoint, Hyperlane, CoW, Uniswap, x402 …) and indexers, with per-chain presence from the bundled registry.",
  risk: "local",
  params: [{ name: "name", type: "string", description: "Show one protocol.", positional: 0 }],
  async run(ctx, a) {
    await ctx.config();
    const chainId = a.chain ? ctx.chainId(a.chain) : undefined;
    const list = a.name ? [getProtocol(a.name)] : listProtocols();
    const rows = list.map((p) => ({ ...p, onChain: chainId === undefined ? undefined : p.chains?.includes(chainId) ? "listed" : p.absentOn?.includes(chainId) ? "absent" : "unknown" }));
    const meta = protocolsMeta();
    return {
      data: { verifiedAt: meta.verifiedAt, note: meta.note, chainId, protocols: rows, indexers: a.name ? undefined : listIndexers() },
      text: [
        `protocol registry (snapshot ${meta.verifiedAt ?? "?"}; re-check with: up protocols verify <name> --chain <id>)`,
        ...rows.map(
          (p) =>
            `${p.name}: ${p.description ?? ""}` +
            (p.addresses.length ? `\n  ${p.addresses.map((x) => `${x.role} ${x.address}`).join("\n  ")}` : "") +
            (p.chains ? `\n  code confirmed on: ${p.chains.join(", ")}` : "") +
            (p.absentOn ? `\n  absent on: ${p.absentOn.join(", ")}` : "") +
            (p.onChain ? `\n  chain ${chainId}: ${p.onChain}` : ""),
        ),
      ].join("\n"),
    };
  },
});

defineVerb({
  name: "protocols verify",
  group: "knowledge",
  summary: "Re-check protocol code presence on a chain right now (eth_getCode; ERC-165 for LSP26); all protocols when no name is given.",
  risk: "read",
  params: [{ name: "name", type: "string", description: "Protocol key from `protocols list` (omit for all).", positional: 0 }],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const names = a.name ? [getProtocol(a.name).name] : listProtocols().filter((p) => p.addresses.length).map((p) => p.name);
    const results = [];
    for (const n of names) results.push(await verifyProtocol(ctx, n, chainId));
    const warnings = results.flatMap((r) => r.warnings);
    return {
      data: { chainId, results },
      text: results.map((r) => `${r.protocol}: ${r.summary}${r.results.length > 1 ? ` (${r.results.map((x) => `${x.role}=${x.status}`).join(", ")})` : ""}`).join("\n"),
      warnings: warnings.length ? warnings : undefined,
    };
  },
});
