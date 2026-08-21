/** iFinD shortName 经常直接返回六位代码，不能当产品简称用。 */

export function isCodeLikeName(name: string, code: string): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  const bare = String(code || "").replace(/\.(SH|SZ)$/i, "");
  if (n === code || n === bare) return true;
  return /^\d{6}(\.(SH|SZ))?$/i.test(n);
}

export function pickEtfDisplayName(
  code: string,
  apiName: string | undefined,
  whitelistName?: string,
): string {
  const api = (apiName || "").trim();
  if (api && !isCodeLikeName(api, code)) return api;
  if (whitelistName && whitelistName.trim()) return whitelistName.trim();
  return String(code || "").replace(/\.(SH|SZ)$/i, "") || api;
}
