/** True when the link is safe to show as「阅读原文」. */
export function isReadableSourceUrl(url: string | undefined | null): boolean {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com")) return false;
    return true;
  } catch {
    return false;
  }
}
