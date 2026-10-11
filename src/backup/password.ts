// Where the backup password comes from. Owner decision (design section 9): the backup password may
// pass through the chat, because the file is useless without it and in cloud agent VMs the chat is
// the only channel. So there is no terminal requirement, and the password is NOT registered with the
// output guard (the generated one is returned to the agent on purpose, in `data.password`).
// Private keys stay registered and never appear in any output.
//
// Sources, exactly one: --password <text>, --password-env <NAME>, --password-stdin, or (export
// only) a generated password. Owner decision (2026-10-10): people must be able to remember their
// password, or the encryption is pointless, so a human-chosen password needs only 6 characters, but
// with at least one lowercase letter, one uppercase letter, one digit and one symbol.
import { randomInt } from "node:crypto";
import { UpError } from "../core/errors.ts";

/** 56 symbols without the look-alikes 0 O 1 l I: 20 symbols are about 116 bits. */
export const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const MIN_PASSWORD_LENGTH = 6;
const MAX_STDIN_BYTES = 4096;

/** What a human-chosen backup password still lacks, in plain words (empty: it is fine). */
export function passwordProblems(password: string): string[] {
  const missing: string[] = [];
  if ([...password].length < MIN_PASSWORD_LENGTH) missing.push(`at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!/\p{Ll}/u.test(password)) missing.push("a lowercase letter");
  if (!/\p{Lu}/u.test(password)) missing.push("an uppercase letter");
  if (!/\p{Nd}/u.test(password)) missing.push("a number");
  if (!/[^\p{L}\p{N}\s]/u.test(password)) missing.push("a symbol (like ! ? # - _ .)");
  return missing;
}

/**
 * 20 random symbols from PASSWORD_ALPHABET in groups of five: XXXXX-XXXXX-XXXXX-XXXXX (the dashes are
 * part of the password and count as its symbol). Drawn again until it also has a lowercase letter,
 * an uppercase letter and a number, so it meets the same rule as a chosen password.
 */
export function generatePassword(): string {
  for (;;) {
    const pw = drawPassword();
    if (!passwordProblems(pw).length) return pw;
  }
}

/** One uniform draw: XXXXX-XXXXX-XXXXX-XXXXX from PASSWORD_ALPHABET (exported for the uniformity test). */
export function drawPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let part = "";
    for (let i = 0; i < 5; i++) part += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    groups.push(part);
  }
  return groups.join("-");
}

export interface PasswordArgs {
  password?: string;
  "password-env"?: string;
  "password-stdin"?: boolean;
  "generate-password"?: boolean;
}

export interface PasswordChoice {
  password: string;
  source: "argument" | "env" | "stdin" | "generated";
  generated: boolean;
  warnings: string[];
}

export const PASSWORD_PARAMS = [
  { name: "password", type: "string" as const, description: "The backup password the human chose and told you in chat (at least 6 characters with a lowercase and an uppercase letter, a number and a symbol; one they will remember). Omit to have one generated." },
  { name: "password-env", type: "string" as const, description: "Name of an environment variable that holds the backup password (read once, then removed from this process)." },
  { name: "password-stdin", type: "boolean" as const, description: "Read the backup password from standard input (CLI only; not available over MCP)." },
];

async function readStdin(): Promise<string> {
  if (process.env.UP_MCP_SERVER === "1") throw new UpError("BAD_ARGS", "--password-stdin is not available over MCP (standard input carries the protocol)", { hint: "pass --password or --password-env" });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += (c as Buffer).length;
    if (size > MAX_STDIN_BYTES) throw new UpError("BAD_ARGS", "the password on standard input is too long");
    chunks.push(Buffer.from(c as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

/**
 * The password for this run, or undefined when none was given and none is wanted (`forExport`
 * false: opening a file needs the human's password, there is nothing to generate).
 */
export async function choosePassword(args: PasswordArgs, forExport: boolean): Promise<PasswordChoice | undefined> {
  const given = [args.password !== undefined, args["password-env"] !== undefined, args["password-stdin"] === true, args["generate-password"] === true].filter(Boolean).length;
  if (given > 1) throw new UpError("BAD_ARGS", "give only one of --password, --password-env, --password-stdin, --generate-password");
  if (args["generate-password"] === true && !forExport) throw new UpError("BAD_ARGS", "--generate-password only applies when making a backup");

  let password: string;
  let source: PasswordChoice["source"];
  if (args.password !== undefined) {
    password = args.password;
    source = "argument";
  } else if (args["password-env"] !== undefined) {
    const name = args["password-env"];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UpError("BAD_ARGS", "--password-env must be the name of an environment variable");
    const v = process.env[name];
    if (!v) throw new UpError("BAD_ARGS", `the environment variable ${name} is not set or empty`);
    delete process.env[name]; // never inherited by anything spawned later
    password = v;
    source = "env";
  } else if (args["password-stdin"] === true) {
    password = await readStdin();
    source = "stdin";
  } else if (forExport) {
    return { password: generatePassword(), source: "generated", generated: true, warnings: [] };
  } else return undefined;

  if (!password) throw new UpError("BAD_ARGS", "the password is empty");
  const warnings: string[] = [];
  if (forExport) {
    const missing = passwordProblems(password);
    if (missing.length) {
      throw new UpError("BAD_ARGS", `the backup password needs ${missing.join(", ")}`, {
        hint: `ask the human for a password they will remember, with at least ${MIN_PASSWORD_LENGTH} characters, a lowercase and an uppercase letter, a number and a symbol; or omit it to have one generated`,
      });
    }
  }
  return { password, source, generated: false, warnings };
}

/** A hint is public text stored in the file: at most 255 characters and never the password itself. */
export function checkHint(hint: string | undefined, password: string): string | undefined {
  const h = hint?.trim();
  if (!h) return undefined;
  if ([...h].length > 255) throw new UpError("BAD_ARGS", "the password hint is longer than 255 characters");
  if (h.includes(password) || h.replace(/[-\s]/g, "").includes(password.replace(/[-\s]/g, ""))) throw new UpError("BAD_ARGS", "the password hint contains the password; the hint is stored unencrypted in the file");
  return h;
}
