// QR codes for addresses handed to the user (never for keys):
//  - the plain checksummed address (scannable by MetaMask, Rainbow, the UP
//    extension, hardware-wallet apps …) — the default;
//  - an EIP-681 payment URI variant that pre-fills chain and amount in wallets
//    that honour it: native `ethereum:<addr>@<chainId>?value=<wei>` or ERC-20
//    `ethereum:<token>@<chainId>/transfer?address=<to>&uint256=<amount>`.
// The symbol matrix comes from the bundled pure-JS `qrcode` package; PNG and
// UTF-8 renderings are both drawn from that same matrix by our own code.
import QRCode from "qrcode";
import { getAddress, isAddress, type Address } from "viem";
import { encodeIndexedPng, scaleGrid } from "./png.ts";

export type QrErrorLevel = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  text: string;
  size: number;
  version: number;
  errorCorrectionLevel: QrErrorLevel;
  /** size*size, row-major, 1 = dark module. */
  modules: Uint8Array;
}

export function qrMatrix(text: string, errorCorrectionLevel: QrErrorLevel = "M"): QrMatrix {
  if (!text) throw new Error("QR text is empty");
  const q = QRCode.create(text, { errorCorrectionLevel });
  const size = q.modules.size;
  const modules = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) modules[i] = q.modules.data[i] ? 1 : 0;
  return { text, size, version: q.version, errorCorrectionLevel, modules };
}

export interface QrPngOptions {
  /** Pixels per module (default 8). */
  scale?: number;
  /** Quiet zone in modules (spec minimum and default: 4). */
  margin?: number;
}

/** Dark-on-light PNG (palette: 0 = white, 1 = black) with a quiet zone. */
export function qrPng(m: QrMatrix, opts: QrPngOptions = {}): Buffer {
  const scale = opts.scale ?? 8;
  const margin = opts.margin ?? 4;
  const { width, height, pixels } = scaleGrid(m.modules, m.size, m.size, scale, margin, 0);
  return encodeIndexedPng({ width, height, palette: [[255, 255, 255], [0, 0, 0]], pixels });
}

export interface QrTextOptions {
  /** Quiet zone in modules (default 2; most phone scanners cope with 2 on screen). */
  margin?: number;
  /**
   * Draw light modules as filled blocks (default true). Terminals and chat code
   * blocks are usually light text on a dark background, so filling the light
   * modules yields a correctly coloured (dark-on-light) symbol there.
   */
  lightIsFilled?: boolean;
}

/**
 * UTF-8 rendering with half blocks: each character covers two module rows
 * (top/bottom), so the result is roughly square in monospace fonts.
 */
export function qrText(m: QrMatrix, opts: QrTextOptions = {}): string {
  const margin = opts.margin ?? 2;
  const filled = opts.lightIsFilled ?? true;
  const total = m.size + 2 * margin;
  // module value at padded coordinates; outside the symbol = light (0)
  const dark = (r: number, c: number) => {
    const rr = r - margin;
    const cc = c - margin;
    if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) return false;
    return m.modules[rr * m.size + cc] === 1;
  };
  const on = (r: number, c: number) => (r >= total ? false : filled ? !dark(r, c) : dark(r, c));
  const lines: string[] = [];
  for (let r = 0; r < total; r += 2) {
    let line = "";
    for (let c = 0; c < total; c++) {
      const top = on(r, c);
      const bottom = on(r + 1, c);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Inverse of qrText (used by tests to prove PNG and text show the same symbol). */
export function parseQrText(text: string, size: number, opts: QrTextOptions = {}): Uint8Array {
  const margin = opts.margin ?? 2;
  const filled = opts.lightIsFilled ?? true;
  const lines = text.split("\n");
  const total = size + 2 * margin;
  const grid = new Uint8Array(total * (lines.length * 2));
  lines.forEach((line, i) => {
    [...line].forEach((ch, c) => {
      const top = ch === "█" || ch === "▀";
      const bottom = ch === "█" || ch === "▄";
      grid[2 * i * total + c] = top ? 1 : 0;
      grid[(2 * i + 1) * total + c] = bottom ? 1 : 0;
    });
  });
  const out = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = grid[(r + margin) * total + (c + margin)];
      out[r * size + c] = filled ? (v ? 0 : 1) : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// EIP-681 (https://eips.ethereum.org/EIPS/eip-681)
// ---------------------------------------------------------------------------

function checksummed(a: string, what: string): Address {
  if (!isAddress(a, { strict: false })) throw new Error(`invalid ${what} address: ${a}`);
  return getAddress(a);
}

function nonNegative(v: bigint, what: string): bigint {
  if (v < 0n) throw new Error(`${what} must not be negative`);
  return v;
}

/** `ethereum:<address>@<chainId>[?value=<wei>]` — native-currency payment request. */
export function eip681Native(address: string, chainId: number, valueWei?: bigint): string {
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`invalid chain id ${chainId}`);
  let uri = `ethereum:${checksummed(address, "recipient")}@${chainId}`;
  if (valueWei !== undefined && nonNegative(valueWei, "value") > 0n) uri += `?value=${valueWei.toString()}`;
  return uri;
}

/** `ethereum:<token>@<chainId>/transfer?address=<to>&uint256=<amount>` — ERC-20 transfer request (amount in base units). */
export function eip681Erc20Transfer(tokenAddress: string, chainId: number, to: string, amount: bigint): string {
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`invalid chain id ${chainId}`);
  return `ethereum:${checksummed(tokenAddress, "token")}@${chainId}/transfer?address=${checksummed(to, "recipient")}&uint256=${nonNegative(amount, "amount").toString()}`;
}
