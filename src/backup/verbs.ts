// Backup verbs (group "backup"): export, list, inspect, verify, import. LSP-30 backup files that
// the Universal Profile mobile app can also read and write (see lsp30-crypto.ts / lsp30-format.ts).
//
// Rules the verbs keep:
//  - The file is ciphertext; the agent never reads, prints or uploads its contents. It passes
//    `data.path` to the chat's attachment mechanism. Results hold public data only: addresses,
//    paths, hashes. Private keys never appear in any result, error, log or index line.
//  - The backup password may pass through the chat (owner decision), so it is not registered with
//    the output guard; a generated password is returned once, in `data.password`.
//  - Keys are permanent: nothing here deletes or overwrites a key, a manifest or a backup.
//
// This file only declares the verbs (name, parameters, help); the code behind them is in run.ts and is
// loaded when a backup verb actually runs, so the shipped bundle loads it as a separate chunk.
import { defineVerb } from "../core/verbs.ts";
import { PASSWORD_PARAMS } from "./password.ts";

const MODES = ["encrypted", "public", "unencrypted"] as const;

const PASSWORD_HELP = [
  ...PASSWORD_PARAMS,
  { name: "generate-password", type: "boolean" as const, description: "Generate a strong password (the default for export when no password is given); it is returned in data.password so you can tell the human." },
];

defineVerb({
  name: "backup export",
  group: "backup",
  summary: "Make a backup file of the agent's profiles and keys that the Universal Profile mobile app can import (LSP-30), encrypted with a password by default.",
  description:
    "Covers every profile and every key the agent has (--profiles narrows the profiles); each profile lists only its own controllers, the other keys are only in the file's secrets. Mode encrypted (default): keys locked with the password the human chose (--password, 12+ characters) or, if omitted, a generated one returned once in `data.password`: tell it to the human with the file (`data.say`). " +
    "Mode public: no keys, no password. Mode unencrypted: keys in plain text; needs --explicit-consent and a human --approval, loud warning. " +
    "Saved in <UP_HOME>/backups (never overwrites) as `<your display name> - universal-profiles-backup-YYYY-MM-DD.json` (pass --bot-name with your own display name; never guess another agent's or brand's name), or at --path exactly as given. Send `data.path` to the human as a chat attachment; never read it. The app's format hashes the password only 10,000 times: prefer the generated one.",
  risk: "secret",
  params: [
    { name: "path", type: "string", positional: 0, description: "Where to write the file (must not exist; its folder must exist). Used exactly as given, without the agent prefix. Default: <UP_HOME>/backups/<agent display name> - universal-profiles-backup-YYYY-MM-DD.json." },
    { name: "bot-name", type: "string", description: "Your own display name as the human sees it in this chat (e.g. \"Alice\"): the default file name starts with it. Pass it every time; if omitted, the host's UP_AGENT_NAME is used, else the name has no prefix. A public label only, never a key or password; unsafe characters are removed." },
    { name: "mode", type: "string", enum: MODES, default: "encrypted", description: "encrypted (keys locked with a password, default), public (no keys at all) or unencrypted (keys in plain text; dangerous)." },
    { name: "profiles", type: "string[]", description: "Only these profiles (addresses or aliases). Default: every profile on this machine. The keys are always all of the agent's keys." },
    ...PASSWORD_HELP,
    { name: "hint", type: "string", description: "A hint for the password (up to 255 characters). It is stored unencrypted in the file and must not contain the password." },
    { name: "explicit-consent", type: "boolean", default: false, description: "Required for --mode unencrypted: the human explicitly wants the keys in a file without a password." },
    { name: "refresh", type: "boolean", default: false, description: "Also read each profile's current controllers from the networks (best effort, 8 seconds per network)." },
  ],
  examples: ["up backup export --bot-name \"<your display name>\" --approval \"<the human's words>\"", "up backup export --mode public --bot-name \"<your display name>\"", "up backup export --profiles 0x… --password-env MY_BACKUP_PASSWORD --approval \"<their words>\""],
  run: (ctx, a) => import("./run.ts").then((m) => m.runExport(ctx, a)),
});

defineVerb({
  name: "backup list",
  group: "backup",
  summary: "The backups made on this machine, whether they cover the agent's current keys and profiles, and whether to offer the human a new one (`data.ask`).",
  description:
    "Checks each backup in <UP_HOME>/backups/index.jsonl (still there, unchanged; no decryption) against the current keys and profiles. `data.ask` is null or a question for the human: ask it once in your own words, then run this with --mark-asked. Plain-text backups that still exist are flagged.",
  risk: "local",
  params: [{ name: "mark-asked", type: "boolean", default: false, description: "Record that the human has just been asked about a backup (no question is returned again until something changes)." }],
  run: (ctx, a) => import("./run.ts").then((m) => m.runList(ctx, a)),
});

defineVerb({
  name: "backup inspect",
  group: "backup",
  summary: "Read a backup file (never decrypts it) and show what it contains: profiles, networks, controllers, the deployment data and whether it checks out, and every problem found.",
  description:
    "Safe on any backup file, also one the human sent: no password, public data only (addresses, names as quoted text, the password hint). Re-derives each profile address from the file's deployment data; a mismatch means the file may be forged. Never prints encrypted data or any key.",
  risk: "local",
  params: [{ name: "path", type: "string", positional: 0, required: true, description: "Path of the backup file (for a chat attachment, the path the host saved it to)." }],
  run: (ctx, a) => import("./run.ts").then((m) => m.runInspect(ctx, a)),
});

defineVerb({
  name: "backup verify",
  group: "backup",
  summary: "Open a backup file in memory with its password and check it: the keys inside (addresses only), which are already here, and with --online whether each profile could be restored.",
  description:
    "The checks of backup import, changing nothing. Key addresses are derived from the keys, never trusted from the file. With --online each profile is checked on its networks the way the app does (a backup key still controls it, or the file proves a key created it). Prints addresses only.",
  risk: "read",
  params: [
    { name: "path", type: "string", positional: 0, required: true, description: "Path of the backup file." },
    ...PASSWORD_PARAMS,
    { name: "online", type: "boolean", default: false, description: "Also check each profile on its networks (needs network access)." },
  ],
  run: (ctx, a) => import("./run.ts").then((m) => m.runVerify(ctx, a)),
});

defineVerb({
  name: "backup import",
  group: "backup",
  summary: "Restore profiles and keys from a backup file (made by this skill or by the Universal Profile app): keys go into a key store, profiles into the local records. Needs the human's approval.",
  description:
    "The human sends the file as a chat attachment (the host saves it to a path) and the password in chat. A profile is restored only if the network shows a backup key still controls it, or the file proves a backup key created it (its deployment data re-derives the profile address); a file claiming someone else's profile is refused. " +
    "Keys are permanent: none is overwritten or deleted, each new one is recorded before it is stored, one already here is skipped. Restored keys become additional keys; one becomes the active key only if none was set up. Restores the keys of the selected profiles, or all with --all-keys.",
  risk: "secret",
  params: [
    { name: "path", type: "string", positional: 0, required: true, description: "Path of the backup file." },
    ...PASSWORD_PARAMS,
    { name: "profiles", type: "string[]", description: "Only these profiles of the file (addresses). Default: every profile that can be restored." },
    { name: "backend", type: "string", description: "Key store for the restored keys (default: what `up init` would choose)." },
    { name: "all-keys", type: "boolean", default: false, description: "Restore every key in the file, not only those of the selected profiles." },
    { name: "offline", type: "boolean", default: false, description: "Skip the check on the networks. Only when the human's approval says 'offline' in their words." },
  ],
  examples: ["up backup import /path/to/universal-profiles-backup-2026-10-10.json --password-env BACKUP_PASSWORD --approval \"<the human's words>\""],
  run: (ctx, a) => import("./run.ts").then((m) => m.runImport(ctx, a)),
});
