// Display verbs: qr, identicon, display address.
// Images are written as PNG files to $UP_HOME/media and returned as MediaFile
// entries (MCP hosts attach them); every result also carries plain text (the
// checksummed address, chain name + id, asset, amount and a "switch your wallet
// to this network" note) and a UTF-8 QR for text-only clients.
// QR codes are generated only for addresses / payment URIs — never for keys.
import type { Address } from "viem";
import type { MediaFile, VerbContext } from "../core/types.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import { checksum } from "../core/context.ts";
import { blockieColorsHex, blockiePng, blockieText, BLOCKIE_GRID } from "./blockies.ts";
import { eip681Erc20Transfer, eip681Native, qrMatrix, qrPng, qrText } from "./qr.ts";
import { writeMedia } from "./media.ts";
import { resolveAsset, assetLabel, formatAmount, parseAmount, type AssetInfo } from "../tokens/assets.ts";

/** Refuses anything that looks like key material; returns the checksummed address. */
export function displayableAddress(input: unknown): Address {
  const s = String(input ?? "").trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) {
    throw new UpError("BAD_ARGS", "this looks like a private key or a 32-byte hash — QR codes and identicons are only generated for 20-byte addresses", {
      hint: "never paste or display private keys; pass the public address",
    });
  }
  return checksum(s);
}

interface ChainFacts {
  chainId: number;
  name: string;
  nativeSymbol: string;
}

async function optionalChain(ctx: VerbContext, a: Record<string, any>): Promise<ChainFacts | undefined> {
  await ctx.config();
  let id: number;
  try {
    id = ctx.chainId(a.chain);
  } catch (e) {
    if (a.chain) throw e;
    return undefined;
  }
  try {
    const c = ctx.registry.chain(id);
    return { chainId: id, name: c.name, nativeSymbol: c.nativeSymbol };
  } catch {
    return { chainId: id, name: `chain ${id}`, nativeSymbol: "native coin" };
  }
}

export interface PaymentRequest {
  address: Address;
  chain?: ChainFacts;
  asset?: AssetInfo;
  amount?: bigint;
  label?: string;
}

/** Plain-text block that always accompanies a QR code. */
export function paymentText(p: PaymentRequest): string {
  const lines = [`${p.label ? `${p.label}: ` : ""}${p.address}`];
  if (p.chain) {
    lines.push(`Network: ${p.chain.name} (chain id ${p.chain.chainId}) — switch your wallet to this network before sending.`);
  } else lines.push("Network: not specified — make sure the sender uses the intended network.");
  if (p.asset) {
    lines.push(`Asset: ${assetLabel(p.asset)}${p.asset.symbol ? "" : " (no symbol)"}`);
    if (p.amount !== undefined) lines.push(`Amount: ${formatAmount(p.amount, p.asset.decimals)}${p.asset.symbol ? ` ${p.asset.symbol}` : ""} (${p.amount} base units)`);
  } else if (p.chain) {
    lines.push(`Asset: ${p.chain.nativeSymbol} (native coin)`);
    if (p.amount !== undefined) lines.push(`Amount: ${formatAmount(p.amount, 18)} ${p.chain.nativeSymbol} (${p.amount} wei)`);
  }
  return lines.join("\n");
}

async function qrMedia(ctx: VerbContext, text: string, nameHint: string, description: string, scale: number): Promise<{ media: MediaFile; utf8: string; version: number; size: number }> {
  const m = qrMatrix(text);
  const media = await writeMedia(ctx.home, nameHint, qrPng(m, { scale }), description);
  return { media, utf8: qrText(m), version: m.version, size: m.size };
}

async function buildPayment(ctx: VerbContext, a: Record<string, any>): Promise<PaymentRequest> {
  const address = displayableAddress(a.address);
  const chain = await optionalChain(ctx, a);
  const p: PaymentRequest = { address, chain, label: a.label };
  if (a.token) {
    if (!chain) throw new UpError("BAD_ARGS", "--token needs a chain: pass --chain");
    p.asset = await resolveAsset(ctx, chain.chainId, checksum(a.token));
    if (a.amount !== undefined) {
      if (p.asset.standard !== "LSP7" && p.asset.standard !== "ERC20") throw new UpError("BAD_ARGS", `--amount applies to fungible tokens; ${p.asset.standard} is an NFT standard`);
      p.amount = parseAmount(a.amount, p.asset.decimals);
    }
  } else if (a.amount !== undefined) {
    if (!chain) throw new UpError("BAD_ARGS", "--amount needs a chain (the amount is in that chain's native coin): pass --chain");
    p.amount = parseAmount(a.amount, 18);
  }
  return p;
}

/** EIP-681 URI for the request, or a reason why none applies. */
export function paymentUri(p: PaymentRequest): { uri?: string; reason?: string } {
  if (!p.chain) return { reason: "EIP-681 needs a chain id" };
  if (!p.asset) return { uri: eip681Native(p.address, p.chain.chainId, p.amount) };
  if (p.asset.standard === "ERC20") {
    if (p.amount === undefined) return { reason: "the EIP-681 ERC-20 form needs an amount (--amount)" };
    return { uri: eip681Erc20Transfer(p.asset.address, p.chain.chainId, p.address, p.amount) };
  }
  return { reason: `${p.asset.standard} transfers cannot be expressed as an EIP-681 URI that wallets pre-fill; send to the plain address` };
}

const SCALE_PARAM = { name: "scale", type: "integer" as const, description: "QR pixels per module (2–20).", default: 8 };

defineVerb({
  name: "qr",
  group: "display",
  summary: "QR code for an address (plain checksummed address, scannable by any wallet) + EIP-681 payment-URI variant; PNG files + UTF-8 QR + text with chain/asset/amount.",
  description:
    "Default = both variants: the plain-address QR (works in MetaMask and every wallet's send scanner) and, when a chain is known, an EIP-681 URI (ethereum:<addr>@<chainId>?value=<wei>, or the ERC-20 transfer form) for wallets that pre-fill network and amount. Not every wallet honours @chainId, so the text always repeats network, asset and amount. Only for addresses — never for keys.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Address to receive funds/assets (checksummed in the output).", positional: 0, required: true },
    { name: "amount", type: "string", description: "Requested amount in human units (native coin, or --token units)." },
    { name: "token", type: "string", description: "Token contract for an asset request (ERC-20 gets an EIP-681 transfer URI; LSP7/NFTs plain address only)." },
    { name: "variant", type: "string", description: "plain, eip681 or both.", enum: ["both", "plain", "eip681"], default: "both" },
    { name: "label", type: "string", description: 'Label shown in the text, e.g. "controller (gas)".' },
    SCALE_PARAM,
  ],
  examples: ["up qr 0xController… --chain 42 --amount 0.05 --label \"controller (gas)\"", "up qr 0xProfile… --chain base --token 0xUSDC… --amount 25"],
  async run(ctx, a) {
    if (a.scale < 2 || a.scale > 20) throw new UpError("BAD_ARGS", "--scale must be between 2 and 20");
    const p = await buildPayment(ctx, a);
    const media: MediaFile[] = [];
    const warnings: string[] = [];
    const text = paymentText(p);
    const out: Record<string, unknown> = { address: p.address, chainId: p.chain?.chainId, chainName: p.chain?.name, nativeSymbol: p.chain?.nativeSymbol, asset: p.asset?.address, assetStandard: p.asset?.standard, assetSymbol: p.asset?.symbol, amount: p.amount?.toString(), text };
    let utf8: string | undefined;
    if (a.variant !== "eip681") {
      const q = await qrMedia(ctx, p.address, `qr-${p.address.slice(2, 10)}`, `QR code: ${p.address} (plain address${p.chain ? `, ${p.chain.name}` : ""})`, a.scale);
      media.push(q.media);
      utf8 = q.utf8;
      out.plain = { content: p.address, version: q.version, modules: q.size, utf8: q.utf8, file: q.media.path };
    }
    const u = paymentUri(p);
    if (a.variant !== "plain") {
      if (u.uri) {
        const q = await qrMedia(ctx, u.uri, `qr-eip681-${p.address.slice(2, 10)}`, `QR code (EIP-681 payment request): ${u.uri}`, a.scale);
        media.push(q.media);
        utf8 ??= q.utf8;
        out.eip681 = { content: u.uri, version: q.version, modules: q.size, utf8: q.utf8, file: q.media.path };
      } else {
        out.eip681 = { reason: u.reason };
        if (a.variant === "eip681") throw new UpError("BAD_ARGS", `no EIP-681 variant: ${u.reason}`);
        warnings.push(`no EIP-681 variant: ${u.reason}`);
      }
    }
    if (p.asset) warnings.push(...p.asset.warnings, "token symbols are chosen by the token contract — verify the token address, not just the symbol");
    warnings.push("wallets do not all honour the network in a QR code: check the network in the wallet before sending");
    return {
      data: out,
      text: `${utf8 ?? ""}\n${text}${out.eip681 && (out.eip681 as { content?: string }).content ? `\nEIP-681: ${(out.eip681 as { content: string }).content}` : ""}`,
      media,
      warnings,
    };
  },
});

defineVerb({
  name: "identicon",
  group: "display",
  summary: "Blockies identicon for an address (faithful port of ethereum-blockies-base64) as PNG + text approximation.",
  risk: "local",
  params: [
    { name: "address", type: "string", description: "Address.", positional: 0, required: true },
    { name: "size", type: "integer", description: "Image size in pixels, a multiple of 8 between 8 and 1024 (128 = upstream default).", default: 128 },
  ],
  async run(ctx, a) {
    const address = displayableAddress(a.address);
    if (a.size < 8 || a.size > 1024 || a.size % BLOCKIE_GRID !== 0) throw new UpError("BAD_ARGS", "--size must be a multiple of 8 between 8 and 1024");
    const media = await writeMedia(ctx.home, `identicon-${address.slice(2, 10)}`, blockiePng(address, a.size / BLOCKIE_GRID), `Identicon (blockies) for ${address}`);
    const textArt = blockieText(address);
    return { data: { address, size: a.size, colors: blockieColorsHex(address), file: media.path, text: textArt }, text: `${textArt}\n${address}`, media: [media] };
  },
});

defineVerb({
  name: "display address",
  group: "display",
  summary: "Present an address to a human: identicon + plain-address QR (+ EIP-681 when --amount) + checksummed text with network and funding note.",
  description: "Used by onboarding to show precomputed profile candidates and funding requests (controller gas, profile assets).",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Address.", positional: 0, required: true },
    { name: "label", type: "string", description: 'What this address is, e.g. "Profile candidate #1" or "controller (gas)".' },
    { name: "amount", type: "string", description: "Requested native amount (adds an EIP-681 QR)." },
    { name: "token", type: "string", description: "Token contract when requesting an asset." },
    SCALE_PARAM,
  ],
  async run(ctx, a) {
    if (a.scale < 2 || a.scale > 20) throw new UpError("BAD_ARGS", "--scale must be between 2 and 20");
    const p = await buildPayment(ctx, a);
    const media: MediaFile[] = [];
    media.push(await writeMedia(ctx.home, `identicon-${p.address.slice(2, 10)}`, blockiePng(p.address), `Identicon (blockies) for ${p.address}`));
    const plain = await qrMedia(ctx, p.address, `qr-${p.address.slice(2, 10)}`, `QR code: ${p.address} (plain address${p.chain ? `, ${p.chain.name}` : ""})`, a.scale);
    media.push(plain.media);
    const text = paymentText(p);
    const warnings: string[] = [];
    let eip681: { content?: string; reason?: string } | undefined;
    if (p.amount !== undefined) {
      const u = paymentUri(p);
      if (u.uri) {
        const q = await qrMedia(ctx, u.uri, `qr-eip681-${p.address.slice(2, 10)}`, `QR code (EIP-681 payment request): ${u.uri}`, a.scale);
        media.push(q.media);
        eip681 = { content: u.uri };
      } else {
        eip681 = { reason: u.reason };
        warnings.push(`no EIP-681 variant: ${u.reason}`);
      }
    }
    if (p.chain) warnings.push("wallets do not all honour the network in a QR code: check the network in the wallet before sending");
    return {
      data: { address: p.address, label: p.label, chainId: p.chain?.chainId, chainName: p.chain?.name, colors: blockieColorsHex(p.address), qr: { content: p.address, utf8: plain.utf8 }, eip681, text, files: media.map((m) => m.path) },
      text: `${blockieText(p.address)}\n\n${plain.utf8}\n${text}${eip681?.content ? `\nEIP-681: ${eip681.content}` : ""}`,
      media,
      warnings: warnings.length ? warnings : undefined,
    };
  },
});
