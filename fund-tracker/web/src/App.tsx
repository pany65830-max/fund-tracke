import { useEffect, useMemo, useState, useRef } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { loadAvailableDates, loadLatest, loadSnapshot } from "./lib/loadData";
import type { DaySnapshot } from "./lib/schema";
import { NewsPage } from "./pages/NewsPage";
import { NewsDetailPage } from "./pages/NewsDetailPage";
import { EtfPage } from "./pages/EtfPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { TickerBar } from "./components/TickerBar";
import { CoverSplash } from "./components/CoverSplash";
import {
  loadSettings,
  saveSettings,
  clearSettings,
  fetchLive,
  ingestAndPublish,
  type LiveSettings,
} from "./lib/liveApi";

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

/** 把 snapshot.updatedAt(ISO UTC) 格式化为北京时间日期+时分，用于全局"数据更新于"。 */
function formatUpdatedAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}`;
}

/** 北京时区当日 yyyy-mm-dd（用于刷新时同步 URL 日期）。 */
function todayStr(): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600000);
  return bj.toISOString().slice(0, 10);
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

function beijingClock(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function Shell() {
  const [clock, setClock] = useState(beijingClock);
  const cursorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => setClock(beijingClock()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const el = cursorRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.hidden = true;
      return;
    }
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let started = false;
    let raf = 0;
    const ease = 0.08;
    const tick = () => {
      x += (tx - x) * ease;
      y += (ty - y) * ease;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };
    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!started) {
        x = tx;
        y = ty;
        started = true;
        raf = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 用 react-router 的 useSearchParams 统一管理 URL 中的 ?date=。
  // 之前直接写 window.location.hash 会绕过 HashRouter 的历史记录
  // （它只监听 popstate/pushState，不监听 hashchange），导致路由内部状态
  // 与实际 URL 脱节、日期切换时好时坏、甚至卡在某个日期上。
  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get("date");

  const [snap, setSnap] = useState<DaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  // 网页填 API 拉数据：设置（localStorage）、刷新状态、跳过下次载入的标记
  const [settings, setSettings] = useState<LiveSettings>(loadSettings());
  const [liveMsg, setLiveMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const skipLoadRef = useRef(false);

  const handleSave = () => {
    saveSettings(settings);
    setLiveMsg("已保存设置");
  };
  const handleClear = () => {
    clearSettings();
    setSettings({ workerUrl: "", token: "" });
    setLiveMsg("已清除 token");
  };
  const handleRefresh = async () => {
    if (!settings.workerUrl || !settings.token) {
      setLiveMsg("请先填写 Worker 地址和 iFinD token 并保存");
      return;
    }
    setRefreshing(true);
    setLiveMsg("正在拉取最新数据…");
    try {
      const live = await fetchLive(settings);
      skipLoadRef.current = true;
      setSearchParams({ date: live.tradeDate });
      setSnap(live);
      setLiveMsg(`已更新于 ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setLiveMsg("刷新失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRefreshing(false);
    }
  };

  const handleIngest = async () => {
    if (!settings.workerUrl || !settings.token) {
      setLiveMsg("请先填写 Worker 地址和 iFinD token 并保存");
      return;
    }
    setPublishing(true);
    setLiveMsg("正在云端拉取行情+全部资讯并写回 GitHub（部署约需 1–2 分钟）…");
    try {
      const live = await ingestAndPublish(settings);
      skipLoadRef.current = true;
      setSearchParams({ date: live.tradeDate });
      setSnap(live);
      const pub = live.published;
      setLiveMsg(
        pub
          ? `已全量更新 ${pub.date} 并触发部署，稍后刷新网站即可见（GitHub Pages 约 1–2 分钟）`
          : `已拉取 ${live.tradeDate}，但 Worker 未配置 GITHUB_TOKEN，未发布`,
      );
    } catch (e) {
      setLiveMsg("全量更新失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPublishing(false);
    }
  };

  const location = useLocation();

  useEffect(() => {
    loadAvailableDates()
      .then((d) => setAvailableDates([...d].sort()))
      .catch(() => setAvailableDates([]));
  }, []);

  useEffect(() => {
    // 刚手动刷新过：保留 live 覆盖，跳过这次（因 setSearchParams 触发的）重新载入
    if (skipLoadRef.current) {
      skipLoadRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setError(null);

        if (!dateParam) {
          // 无日期参数：展示最新快照，并把日期回填到 URL（replace 不污染历史）
          const latest = await loadLatest();
          if (cancelled) return;
          setSnap(latest);
          if (latest.tradeDate) {
            setSearchParams({ date: latest.tradeDate }, { replace: true });
          }
          return;
        }

        const data = await loadSnapshot(dateParam);
        if (cancelled) return;

        // 若该日仍是演示(fx-)占位数据、而 latest 已真实，则回退到 latest
        if (isDemoSnapshot(data)) {
          const latest = await loadLatest();
          if (cancelled) return;
          if (!isDemoSnapshot(latest)) {
            setSnap(latest);
            if (latest.tradeDate) {
              setSearchParams({ date: latest.tradeDate }, { replace: true });
            }
            return;
          }
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
  }, [dateParam]);

  // 以「请求的日期」为准；仅在无 dateParam 时回退到已加载快照的日期。
  const date = dateParam || snap?.tradeDate || "";
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
    setSearchParams({ date: d });
  };

  const navClass = (path: string) =>
    location.pathname === path ||
    (path === "/" && location.pathname.startsWith("/news"))
      ? "active"
      : "";

  const prev = date ? neighborDate(availableDates, date, -1) : null;
  const next = date ? neighborDate(availableDates, date, 1) : null;

  return (
    <div className="app-root">
      <CoverSplash />
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div ref={cursorRef} className="cursor-dot" aria-hidden="true" />
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
          <span className="nav-underline" aria-hidden="true" />
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
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onSave={handleSave}
          onClear={handleClear}
          onRefresh={handleRefresh}
          onIngest={handleIngest}
          refreshing={refreshing}
          publishing={publishing}
          message={liveMsg}
        />
        <div className="live-clock" title="北京时间">
          <span className="live-dot" />
          <span className="clock">{clock}</span>
          <span className="clock-tz">BJT</span>
        </div>
        {snap?.updatedAt ? (
          <span className="updated-at muted">
            数据更新于 {formatUpdatedAt(snap.updatedAt)}（北京时间）
          </span>
        ) : null}
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
      <TickerBar snap={snap} />
    </div>
  );
}

export default function App() {
  return <Shell />;
}
