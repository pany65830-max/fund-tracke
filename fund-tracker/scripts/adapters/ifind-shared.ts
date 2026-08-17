import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Institution } from "../../shared/schema.js";

export {
  asNumber,
  bareCode,
  flattenTables,
  getAccessToken,
  getIfindBase,
  ifindPost,
  toThsCode,
  type IfindJson,
} from "./ifind-client.js";

/** Load .env (key=value, no quotes) into process.env if not already set. */
function loadDotEnv(): void {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
loadDotEnv();

type Whitelist = Record<string, Array<{ code: string; name: string }>>;

const FIRMS: Institution[] = ["huaxia", "efunds", "guotai", "huatai"];

export function loadWhitelist(): Whitelist {
  const path = join(__dirname, "../../config/etf-whitelist.json");
  return JSON.parse(readFileSync(path, "utf8")) as Whitelist;
}

export function loadCodesFromWhitelist(): {
  codes: string[];
  names: Map<string, string>;
  codeFirm: Map<string, Institution>;
} {
  const wl = loadWhitelist();
  const codes: string[] = [];
  const names = new Map<string, string>();
  const codeFirm = new Map<string, Institution>();
  for (const firm of FIRMS) {
    for (const p of wl[firm] || []) {
      codes.push(p.code);
      names.set(p.code, p.name);
      codeFirm.set(p.code, firm);
    }
  }
  return { codes, names, codeFirm };
}
