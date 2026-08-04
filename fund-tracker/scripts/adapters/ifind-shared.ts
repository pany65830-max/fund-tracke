import { readFileSync } from "node:fs";
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

type Whitelist = Record<string, Array<{ code: string; name: string }>>;

const __dirname = dirname(fileURLToPath(import.meta.url));
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
