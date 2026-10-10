// Writes generated images to $UP_HOME/media (dir 0700, files 0600) under
// unique names. Only public data (addresses, payment URIs) is ever rendered —
// never keys or secrets.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { MediaFile } from "../core/types.ts";
import { ensureDir, paths, writeFileAtomic } from "../core/home.ts";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
}

export async function writeMedia(home: string, nameHint: string, png: Uint8Array, description: string): Promise<MediaFile> {
  const dir = paths.media(home);
  await ensureDir(dir, 0o700);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const file = join(dir, `${slug(nameHint)}-${stamp}-${randomBytes(4).toString("hex")}.png`);
  await writeFileAtomic(file, png, 0o600);
  return { path: file, mimeType: "image/png", description };
}
