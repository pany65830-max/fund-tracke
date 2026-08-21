import type { DaySnapshot } from "../lib/schema";
import { formatPct } from "../lib/format";
import { displayEtfName } from "../lib/etfNames";

const FIRMS = ["huaxia", "efunds", "guotai", "huatai"] as const;

function loopTape<T>(items: T[]): T[] {
  if (!items.length) return [];
  return items.concat(items);
}

function standoutFunds(snap: DaySnapshot) {
  const rows: Array<{ code: string; name: string; changePct: number }> = [];
  for (const firm of FIRMS) {
    for (const p of snap.etf.productsByFirm[firm] || []) {
      rows.push({
        code: p.code,
        name: displayEtfName(p.code, p.name),
        changePct: p.changePct,
      });
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
  const newsItems = snap.news.map((n) => n.title).filter(Boolean);
  const fundItems = standoutFunds(snap);
  const news = loopTape(newsItems);
  const funds = loopTape(fundItems);
  if (!news.length && !funds.length) return null;
  const newsSec = Math.max(90, newsItems.length * 7);
  const fundSec = Math.max(80, fundItems.length * 8);

  return (
    <div className="tickers" aria-hidden="true">
      {news.length ? (
        <div className="ticker">
          <div className="tape">
            <div className="tape-inner" style={{ animationDuration: `${newsSec}s` }}>
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
            <div
              className="tape-inner rev"
              style={{ animationDuration: `${fundSec}s` }}
            >
              {funds.map((p, i) => (
                <span key={`f-${i}`}>
                  {p.name} {formatPct(p.changePct)}
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
