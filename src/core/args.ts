// Minimal argv parser: words, --flag value, --flag=value, --bool, --no-bool, -- (rest literal).
export interface ParsedArgv {
  words: string[];
  options: Record<string, string | string[] | boolean>;
}

export function parseArgv(argv: string[]): ParsedArgv {
  const words: string[] = [];
  const options: Record<string, string | string[] | boolean> = {};
  let literal = false;
  const set = (k: string, v: string | boolean) => {
    const prev = options[k];
    if (prev === undefined || typeof v === "boolean") options[k] = v;
    else options[k] = Array.isArray(prev) ? [...prev, String(v)] : [String(prev), String(v)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (literal) {
      words.push(a);
      continue;
    }
    if (a === "--") {
      literal = true;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (name.startsWith("no-") && (next === undefined || next.startsWith("--"))) {
        set(name.slice(3), false);
        continue;
      }
      if (next === undefined || (next.startsWith("--") && next !== "--")) {
        set(name, true);
      } else {
        set(name, next);
        i++;
      }
      continue;
    }
    if (a === "-h") {
      set("help", true);
      continue;
    }
    words.push(a);
  }
  return { words, options };
}
