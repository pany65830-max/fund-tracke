import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import holidays from "../../config/holidays-cn.json";
import { nextTradingDay, previousTradingDay } from "./lib/tradingDays";
import { loadLatest, loadSnapshot } from "./lib/loadData";
import type { DaySnapshot } from "./lib/schema";
import { NewsPage } from "./pages/NewsPage";
import { NewsDetailPage } from "./pages/NewsDetailPage";
import { EtfPage } from "./pages/EtfPage";

const holidaySet = new Set(holidays as string[]);

function StatusBanner({ snap }: { snap: DaySnapshot }) {
  const cls =
    snap.status === "ok" ? "ok" : snap.status === "partial" ? "partial" : "failed";
  const text =
    snap.status === "ok"
      ? `数据日期 ${snap.tradeDate} · 今日已更新`
      : snap.status === "partial"
        ? `数据日期 ${snap.tradeDate} · 部分更新失败（展示已成功数据）`
        : `数据日期 ${snap.tradeDate} · 更新失败`;
  return (
    <div className={`banner ${cls}`}>
      {text}
      {snap.errors?.length ? (
        <div className="muted" style={{ marginTop: 4 }}>
          {snap.errors.join("；")}
        </div>
      ) : null}
    </div>
  );
}

function Shell() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dateParam = params.get("date");
  const [snap, setSnap] = useState<DaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const data = dateParam
          ? await loadSnapshot(dateParam)
          : await loadLatest();
        if (!cancelled) setSnap(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateParam]);

  const date = snap?.tradeDate || dateParam || "";

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    next.set("date", d);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  };

  const navClass = (path: string) =>
    location.pathname === path || (path === "/" && location.pathname.startsWith("/news"))
      ? "active"
      : "";

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">基金信息追踪</div>
        <nav className="nav">
          <Link className={navClass("/")} to={date ? `/?date=${date}` : "/"}>
            基金资讯
          </Link>
          <Link className={navClass("/etf")} to={date ? `/etf?date=${date}` : "/etf"}>
            ETF 看板
          </Link>
        </nav>
        {date ? (
          <div className="date-nav">
            <button
              type="button"
              onClick={() => setDate(previousTradingDay(date, holidaySet))}
            >
              上一交易日
            </button>
            <span>{date}</span>
            <button
              type="button"
              onClick={() => setDate(nextTradingDay(date, holidaySet))}
            >
              下一交易日
            </button>
          </div>
        ) : null}
      </header>
      {error ? <div className="banner failed">{error}</div> : null}
      {snap ? <StatusBanner snap={snap} /> : null}
      {snap ? (
        <Routes>
          <Route path="/" element={<NewsPage snap={snap} />} />
          <Route path="/news/:id" element={<NewsDetailPage snap={snap} />} />
          <Route path="/etf" element={<EtfPage snap={snap} />} />
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
