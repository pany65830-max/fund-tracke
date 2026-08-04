export function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function pctClass(n: number): string {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "";
}
