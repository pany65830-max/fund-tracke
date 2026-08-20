import type { DaySnapshot } from "../lib/schema";
import { formatPct } from "../lib/format";

const FIRMS = ["huaxia", "efunds", "guotai", "huatai"] as const;

function repeat<T>(items: T[], min: number): T[] {
  if (!items.length) return [];
  const out = [...items];
  while (out.length < min) out.push(...items);
  return out.concat(out);
}

function standoutFunds(snap: DaySnapshot) {
  const rows: Array<{ code: string; name: string; changePct: number }> = [];
  for (const firm of FIRMS) {
    for (const p of snap.etf.productsByFirm[firm] || []) {
      rows.push({ code: p.code, name: p.name, changePct: p.changePct });
    }
  }
  const gainers = [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 6);
  const losers = [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 6);
  const seen = new Set<string>();
  const mixed: typeof rows = [];
  for (const p of [...gainers, ...losers]) {
    if (seen.has(p.code)) continue;
    seen.add(p.code);
    mixed.push(p);
  }
  return mixed;
}

export function TickerBar({ snap }: { snap: DaySnapshot | null }) {
  if (!snap) return null;
  const news = repeat(
    snap.news.map((n) => n.title).filter(Boolean),
    8,
  );
  const funds = repeat(standoutFunds(snap), 8);
  if (!news.length && !funds.length) return null;

  return (
    <div className="tickers" aria-hidden="true">
      {news.length ? (
        <div className="ticker">
          <div className="tape">
            <div className="tape-inner">
              {news.map((title, i) => (
                <span key={`n-${i}`}>
                  {title}
                  <span className="sep">·</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {funds.length ? (
        <div className="ticker alt">
          <div className="tape">
            <div className="tape-inner rev">
              {funds.map((p, i) => (
                <span key={`f-${i}`}>
                  {p.code} {formatPct(p.changePct)}
                  <span className="sep">·</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
