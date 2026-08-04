import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import holidays from "../../config/holidays-cn.json";
import { nextTradingDay, previousTradingDay } from "./lib/tradingDays";
import { loadAvailableDates, loadLatest, loadSnapshot } from "./lib/loadData";
import type { DaySnapshot } from "./lib/schema";
import { NewsPage } from "./pages/NewsPage";
import { NewsDetailPage } from "./pages/NewsDetailPage";
import { EtfPage } from "./pages/EtfPage";

const holidaySet = new Set(holidays as string[]);

function StatusBanner({ snap }: { snap: DaySnapshot }) {
  const cls =
    snap.status === "ok" ? "ok" : snap.status === "partial" ? "partial" : "failed";
  const isDemo = snap.news.some((n) => n.id.startsWith("fx-"));
  const text =
    snap.status === "ok"
      ? `数据日期 ${snap.tradeDate} · 已更新`
      : snap.status === "partial"
        ? `数据日期 ${snap.tradeDate} · 部分更新失败`
        : `数据日期 ${snap.tradeDate} · 更新失败`;
  return (
    <>
      <div className={`banner ${cls}`}>{text}</div>
      {isDemo ? (
        <div className="banner partial">
          当前为演示数据。GitHub 海外服务器无法访问 iFinD；请在本机配置
          IFIND_REFRESH_TOKEN 后执行 npm run ingest，再推送 data/。
        </div>
      ) : null}
    </>
  );
}

function Shell() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dateParam = params.get("date");
  const [snap, setSnap] = useState<DaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  useEffect(() => {
    loadAvailableDates().then(setAvailableDates).catch(() => setAvailableDates([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const data = dateParam ? await loadSnapshot(dateParam) : await loadLatest();
        if (!cancelled) setSnap(data);
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
  }, [dateParam]);

  const date = snap?.tradeDate || dateParam || "";

  const setDate = (d: string) => {
    if (!d) return;
    if (availableDates.length && !availableDates.includes(d)) {
      setError(`${d} 暂无存档。有数据的日期：${availableDates.join("、")}`);
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
          <button
            type="button"
            disabled={!date}
            onClick={() => date && setDate(previousTradingDay(date, holidaySet))}
          >
            ‹ 前一日
          </button>
          <input
            type="date"
            className="date-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            list="available-dates"
          />
          <datalist id="available-dates">
            {availableDates.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={!date}
            onClick={() => date && setDate(nextTradingDay(date, holidaySet))}
          >
            后一日 ›
          </button>
        </div>
      </header>
      {error ? <div className="banner failed">{error}</div> : null}
      {snap ? <StatusBanner snap={snap} /> : null}
      {snap ? (
        <Routes>
          <Route path="/" element={<NewsPage snap={snap} />} />
          <Route path="/news/:id" element={<NewsDetailPage snap={snap} />} />
          <Route
            path="/etf"
            element={<EtfPage snap={snap} availableDates={availableDates} asOfDate={date} />}
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
