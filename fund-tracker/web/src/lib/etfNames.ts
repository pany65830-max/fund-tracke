import nameMap from "./etf-whitelist-names.json";

const NAMES = nameMap as Record<string, string>;

function isCodeLikeName(name: string, code: string): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  const bare = String(code || "").replace(/\.(SH|SZ)$/i, "");
  if (n === code || n === bare) return true;
  return /^\d{6}(\.(SH|SZ))?$/i.test(n);
}

/** 展示用简称：白名单中文名优先，避免 iFinD 把 shortName 写成代码。 */
export function displayEtfName(code: string, storedName?: string): string {
  const api = (storedName || "").trim();
  if (api && !isCodeLikeName(api, code)) return api;
  const mapped = NAMES[code];
  if (mapped) return mapped;
  return String(code || "").replace(/\.(SH|SZ)$/i, "") || api;
}
