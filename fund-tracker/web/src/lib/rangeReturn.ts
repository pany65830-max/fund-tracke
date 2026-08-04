import type { NewsItem } from "../schema";

export type ProductPoint = {
  code: string;
  name: string;
  firm: string;
  nav?: number;
  changePct: number;
};

/** Inclusive trading-day range return from start/end NAV; falls back to end-day changePct if same day / missing NAV. */
export function rangeReturnPct(
  start: ProductPoint | undefined,
  end: ProductPoint | undefined,
  sameDay: boolean,
): number | null {
  if (!end) return null;
  if (sameDay || !start) return end.changePct;
  if (
    typeof start.nav === "number" &&
    typeof end.nav === "number" &&
    start.nav > 0
  ) {
    return (end.nav / start.nav - 1) * 100;
  }
  return end.changePct;
}

export function flattenProducts(
  productsByFirm: Record<string, Array<{ code: string; name: string; changePct: number; nav?: number; amount?: number }>>,
): ProductPoint[] {
  const out: ProductPoint[] = [];
  for (const [firm, rows] of Object.entries(productsByFirm || {})) {
    for (const p of rows || []) {
      out.push({
        code: p.code,
        name: p.name,
        firm,
        nav: p.nav,
        changePct: p.changePct,
      });
    }
  }
  return out;
}

export function filterNewsByDateHint(items: NewsItem[], _date: string): NewsItem[] {
  return items;
}
