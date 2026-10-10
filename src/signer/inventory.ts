// Recovery inventory of every key the skill created: <UP_HOME>/keys/inventory.jsonl.
// Append-only, public data only (address, key store id, time, optional note). Written as soon
// as a key exists in its store, before config.json or candidates.json record it, so a key whose
// later bookkeeping failed is still listed (key address) and usable (key activate). The file is
// never rewritten; damaged lines are skipped when reading, never dropped from disk.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAddress, isAddress } from "viem";
import type { Address } from "../core/types.ts";
import { appendLine, paths } from "../core/home.ts";

export interface InventoryEntry {
  address: Address;
  backend: string;
  createdAt: string;
  note?: string;
}

export function inventoryFile(home: string): string {
  return join(paths.keys(home), "inventory.jsonl");
}

export async function recordKey(home: string, entry: { address: string; backend: string; createdAt?: string; note?: string }): Promise<void> {
  const line = { address: getAddress(entry.address), backend: entry.backend, createdAt: entry.createdAt ?? new Date().toISOString(), ...(entry.note ? { note: entry.note } : {}) };
  await appendLine(inventoryFile(home), JSON.stringify(line));
}

/** Every recorded key, first record per address (later notes are appended to it). */
export async function readInventory(home: string): Promise<InventoryEntry[]> {
  let text = "";
  try {
    text = await readFile(inventoryFile(home), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: InventoryEntry[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let v: any;
    try {
      v = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!v || typeof v.address !== "string" || !isAddress(v.address, { strict: false }) || typeof v.backend !== "string") continue;
    const prev = out.find((x) => x.address.toLowerCase() === v.address.toLowerCase());
    if (prev) {
      if (v.note) prev.note = prev.note ? `${prev.note}; ${v.note}` : v.note;
      continue;
    }
    out.push({ address: getAddress(v.address), backend: v.backend, createdAt: typeof v.createdAt === "string" ? v.createdAt : "", ...(v.note ? { note: String(v.note) } : {}) });
  }
  return out;
}
