import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { loadAvailableDates, loadLatest, loadSnapshot } from "./lib/loadData";
import type { DaySnapshot } from "./lib/schema";
import { NewsPage } from "./pages/NewsPage";
import { NewsDetailPage } from "./pages/NewsDetailPage";
import { EtfPage } from "./pages/EtfPage";

function isDemoSnapshot(snap: DaySnapshot): boolean {
  return snap.news.some((n) => n.id.startsWith("fx-"));
}

function neighborDate(
  dates: string[],
  current: string,
  dir: -1 | 1,
): string | null {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const idx = sorted.indexOf(current);
  if (idx >= 0) {
    const next = sorted[idx + dir];
    return next || null;
  }
  if (dir < 0) {
    const older = sorted.filter((d) => d < current);
    return older.length ? older[older.length - 1] : null;
  }
  const newer = sorted.filter((d) => d > current);
  return newer.length ? newer[0] : null;
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Calendar strip: from (maxDate-6) through maxDate; unavailable = gray. */
function buildWeekStrip(availableDates: string[]): string[] {
  if (!availableDates.length) return [];
  const max = availableDates[availableDates.length - 1];
  const start = addDays(max, -6);
  const out: string[] = [];
  for (let d = start; d <= max; d = addDays(d, 1)) out.push(d);
  return out;
}

function Shell() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dateParam = params.get("date");
  const [snap, setSnap] = useState<DaySnapshot | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  useEffect(() => {
    loadAvailableDates()
      .then((d) => setAvailableDates([...d].sort()))
      .catch(() => setAvailableDates([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const latest = await loadLatest();
        if (cancelled) return;
        setLatestDate(latest.tradeDate);

        if (!dateParam) {
          setSnap(latest);
          const next = new URLSearchParams(params);
          next.set("date", latest.tradeDate);
          navigate(
            { pathname: location.pathname, search: `?${next.toString()}` },
            { replace: true },
          );
          return;
        }

        const data = await loadSnapshot(dateParam);
        if (cancelled) return;

        if (isDemoSnapshot(data) && !isDemoSnapshot(latest)) {
          setSnap(latest);
          const next = new URLSearchParams(params);
          next.set("date", latest.tradeDate);
          navigate(
            { pathname: location.pathname, search: `?${next.toString()}` },
            { replace: true },
          );
          return;
        }

        setSnap(data);
      } catch (e) {
        if (!cancelled) {
          setSnap(null);
          setError((e as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateParam, location.pathname]);

  const date = snap?.tradeDate || dateParam || "";
  const weekStrip = useMemo(
    () => buildWeekStrip(availableDates),
    [availableDates],
  );
  const minDate = availableDates[0] || "";
  const maxDate = availableDates[availableDates.length - 1] || "";

  const setDate = (d: string) => {
    if (!d) return;
    if (availableDates.length && !availableDates.includes(d)) {
      setError(`${d} 暂无存档`);
      return;
    }
    setError(null);
    const next = new URLSearchParams(params);
    next.set("date", d);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  };

  const navClass = (path: string) =>
    location.pathname === path ||
    (path === "/" && location.pathname.startsWith("/news"))
      ? "active"
      : "";

  const prev = date ? neighborDate(availableDates, date, -1) : null;
  const next = date ? neighborDate(availableDates, date, 1) : null;

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">基金看板</div>
        <nav className="nav">
          <Link className={navClass("/")} to={date ? `/?date=${date}` : "/"}>
            基金资讯
          </Link>
          <Link className={navClass("/etf")} to={date ? `/etf?date=${date}` : "/etf"}>
            ETF 看板
          </Link>
        </nav>
        <div className="date-nav">
          <button type="button" disabled={!prev} onClick={() => prev && setDate(prev)}>
            ‹ 前一日
          </button>
          <input
            type="date"
            className="date-input"
            value={date}
            min={minDate || undefined}
            max={maxDate || undefined}
            onChange={(e) => setDate(e.target.value)}
            list="available-dates"
          />
          <datalist id="available-dates">
            {availableDates.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <button type="button" disabled={!next} onClick={() => next && setDate(next)}>
            后一日 ›
          </button>
        </div>
      </header>

      {weekStrip.length ? (
        <div className="date-chips" aria-label="近一周日期">
          {weekStrip.map((d) => {
            const ok = availableDates.includes(d);
            const active = d === date;
            return (
              <button
                key={d}
                type="button"
                className={`date-chip${active ? " active" : ""}${ok ? "" : " disabled"}`}
                disabled={!ok}
                onClick={() => ok && setDate(d)}
                title={ok ? d : `${d} 无数据`}
              >
                <span className="date-chip-md">{d.slice(5)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? <div className="banner failed">{error}</div> : null}
      {snap ? (
        <Routes>
          <Route path="/" element={<NewsPage snap={snap} />} />
          <Route path="/news/:id" element={<NewsDetailPage snap={snap} />} />
          <Route
            path="/etf"
            element={
              <EtfPage snap={snap} availableDates={availableDates} asOfDate={date} />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : !error ? (
        <p className="muted">加载中…</p>
      ) : null}
    </div>
  );
}

export default function App() {
  return <Shell />;
}
