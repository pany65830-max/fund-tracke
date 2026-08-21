import { useEffect, useMemo, useState } from "react";
import type { DaySnapshot } from "../lib/schema";
import { INSTITUTION_LABEL } from "../lib/labels";
import { formatPct, pctClass } from "../lib/format";
import { displayEtfName } from "../lib/etfNames";
import { SlotPct } from "../components/SlotPct";
import { loadSnapshot } from "../lib/loadData";
import { flattenProducts, rangeReturnPct } from "../lib/rangeReturn";

const FIRMS = ["huaxia", "efunds", "guotai", "huatai"] as const;
type Firm = (typeof FIRMS)[number];

type ProductRow = {
  code: string;
  name: string;
  changePct: number;
  amount?: number;
  nav?: number;
  amplitude?: number;
};

function productKey(firm: string, code: string) {
  return `${firm}::${code}`;
}

/** 把快照的 updatedAt(ISO UTC) 转成北京时间 HH:MM，用于显示「截止时分」。 */
function formatAsOf(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

export function EtfPage({
  snap,
  availableDates,
  asOfDate,
}: {
  snap: DaySnapshot;
  availableDates: string[];
  asOfDate: string;
}) {
  const { etf } = snap;
  const allProducts = useMemo(() => {
    const rows: Array<ProductRow & { firm: Firm }> = [];
    for (const firm of FIRMS) {
      for (const p of (etf.productsByFirm[firm] || []) as ProductRow[]) {
        rows.push({ ...p, firm });
      }
    }
    return rows;
  }, [etf.productsByFirm]);

  const [firmFilter, setFirmFilter] = useState<"all" | Firm>("all");
  const [codeQuery, setCodeQuery] = useState("");
  const [pickedKey, setPickedKey] = useState<string>("all");
  const [rangeStart, setRangeStart] = useState(asOfDate);
  const [rangeEnd, setRangeEnd] = useState(asOfDate);
  const [startSnap, setStartSnap] = useState<DaySnapshot | null>(null);
  const [endSnap, setEndSnap] = useState<DaySnapshot | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  useEffect(() => {
    setRangeStart(asOfDate);
    setRangeEnd(asOfDate);
  }, [asOfDate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setRangeError(null);
        const [a, b] =
          rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];
        const [s, e] = await Promise.all([loadSnapshot(a), loadSnapshot(b)]);
        if (!cancelled) {
          setStartSnap(s);
          setEndSnap(e);
        }
      } catch (err) {
        if (!cancelled) {
          setRangeError((err as Error).message);
          setStartSnap(null);
          setEndSnap(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeStart, rangeEnd]);

  const dropdownOptions = useMemo(() => {
    return allProducts.filter((p) => {
      if (firmFilter !== "all" && p.firm !== firmFilter) return false;
      return true;
    });
  }, [allProducts, firmFilter]);

  useEffect(() => {
    setPickedKey("all");
  }, [firmFilter]);

  const highlightGainers = useMemo(() => {
    return [...allProducts]
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 4);
  }, [allProducts]);

  const highlightTurnover = etf.hotTurnover.slice(0, 4);
  const highlightAmplitude = useMemo(
    () =>
      [...allProducts]
        .sort((a, b) => (b.amplitude ?? 0) - (a.amplitude ?? 0))
        .slice(0, 4),
    [allProducts],
  );

  const sameDay = rangeStart === rangeEnd;
  const startMap = new Map(
    flattenProducts(startSnap?.etf.productsByFirm || {}).map((p) => [
      productKey(p.firm, p.code),
      p,
    ]),
  );
  const endMap = new Map(
    flattenProducts(endSnap?.etf.productsByFirm || {}).map((p) => [
      productKey(p.firm, p.code),
      p,
    ]),
  );

  const resultRows = allProducts
    .filter((p) => {
      if (firmFilter !== "all" && p.firm !== firmFilter) return false;
      const key = productKey(p.firm, p.code);
      if (pickedKey !== "all" && key !== pickedKey) return false;
      const q = codeQuery.trim();
      if (
        q &&
        !p.code.includes(q) &&
        !p.name.includes(q) &&
        !displayEtfName(p.code, p.name).includes(q)
      )
        return false;
      return true;
    })
    .map((p) => {
      const key = productKey(p.firm, p.code);
      const pct = rangeReturnPct(startMap.get(key), endMap.get(key), sameDay);
      return { ...p, rangePct: pct };
    });

  // 按 当日涨跌/区间涨幅 排序；null 值始终排最后
  const sortedRows = useMemo(() => {
    if (!sortDir) return resultRows;
    return [...resultRows].sort((a, b) => {
      const av = a.rangePct;
      const bv = b.rangePct;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [resultRows, sortDir]);

  const toggleSort = () =>
    setSortDir((d) => (d === null ? "desc" : d === "desc" ? "asc" : null));

  const onRangeChange = (which: "start" | "end", value: string) => {
    if (!value) return;
    if (availableDates.length && !availableDates.includes(value)) {
      setRangeError(`${value} 暂无存档`);
      return;
    }
    if (which === "start") setRangeStart(value);
    else setRangeEnd(value);
  };

  const topSectors = [...etf.sectors]
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 4);

  const asOf = formatAsOf(snap.updatedAt);

  return (
    <div className="etf-page">
      <section className="card highlight-card">
        <div className="section-head">
          <h2>当日亮眼数据</h2>
          <span className="muted">
            截至 {snap.tradeDate}
            {asOf ? ` ${asOf}（北京时间）` : ""}
          </span>
        </div>

        <div className="hl-stack">
          <div className="hl-section">
            <h3 className="hl-title">市场指数</h3>
            <div className="index-grid">
              {etf.indices.map((idx) => (
                <div key={idx.code} className="index-tile">
                  <div className="index-name">{idx.name}</div>
                  <div className="index-last">{idx.last.toFixed(2)}</div>
                  <div className="index-chg">
                    <SlotPct value={idx.changePct} />
                  </div>
                </div>
              ))}
              {!etf.indices.length ? <p className="muted">暂无指数</p> : null}
            </div>
          </div>

          <div className="hl-section">
            <h3 className="hl-title">涨幅靠前</h3>
            <div className="hl-list">
              {highlightGainers.map((p, i) => (
                <div key={productKey(p.firm, p.code)} className="hl-list-row">
                  <span className="hl-rank">{i + 1}</span>
                  <div className="hl-list-main">
                    <div className="hl-list-name">{displayEtfName(p.code, p.name)}</div>
                    <div className="muted hl-list-sub">
                      {INSTITUTION_LABEL[p.firm]} · {p.code}
                    </div>
                  </div>
                  <div className="hl-pct">
                    <SlotPct value={p.changePct} />
                  </div>
                </div>
              ))}
              {!highlightGainers.length ? <p className="muted">暂无数据</p> : null}
            </div>
          </div>

          <div className="hl-section">
            <h3 className="hl-title">资金与主题</h3>
            <div className="hot-grid">
              <RankTable
                title="振幅榜"
                unit="%"
                plain
                rows={highlightAmplitude.map((p) => ({
                  code: p.code,
                  name: p.name,
                  value: p.amplitude ?? 0,
                }))}
              />
              <RankTable title="成交额" unit="亿元" rows={highlightTurnover} />
              <div className="rank-card">
                <h3>强势主题</h3>
                <div className="sector-mini">
                  {topSectors.map((s) => (
                    <div key={s.name} className="sector-mini-row">
                      <span className="sector-mini-name">{s.name}</span>
                      <span>
                        <SlotPct value={s.changePct} />
                      </span>
                    </div>
                  ))}
                  {!topSectors.length ? <p className="muted">暂无</p> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>产品涨跌对比</h2>
          <span className="muted">
            {sameDay ? `单日 ${rangeStart}` : `区间 ${rangeStart} → ${rangeEnd}`}
          </span>
        </div>

        <div className="etf-toolbar">
          <label className="field">
            <span>起始日</span>
            <input
              type="date"
              value={rangeStart}
              list="etf-range-dates"
              onChange={(e) => onRangeChange("start", e.target.value)}
            />
          </label>
          <label className="field">
            <span>结束日（相同即单日）</span>
            <input
              type="date"
              value={rangeEnd}
              list="etf-range-dates"
              onChange={(e) => onRangeChange("end", e.target.value)}
            />
          </label>
          <datalist id="etf-range-dates">
            {availableDates.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>

        <div className="etf-toolbar compact">
          <label className="field">
            <span>公司</span>
            <select
              value={firmFilter}
              onChange={(e) => setFirmFilter(e.target.value as "all" | Firm)}
            >
              <option value="all">全部公司</option>
              {FIRMS.map((f) => (
                <option key={f} value={f}>
                  {INSTITUTION_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>产品</span>
            <select
              value={pickedKey}
              onChange={(e) => setPickedKey(e.target.value)}
            >
              <option value="all">该公司全部产品</option>
              {dropdownOptions.map((p) => (
                <option
                  key={productKey(p.firm, p.code)}
                  value={productKey(p.firm, p.code)}
                >
                  {p.code} · {displayEtfName(p.code, p.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>代码搜索</span>
            <input
              type="text"
              placeholder="输入代码，如 512760"
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
            />
          </label>
        </div>

        {rangeError ? <div className="banner failed">{rangeError}</div> : null}

        <div className="table-wrap">
          <table className="data-table">
            <colgroup>
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>公司</th>
                <th>代码</th>
                <th>名称</th>
                <th className="num">
                  <button
                    type="button"
                    className="th-sort"
                    onClick={toggleSort}
                    title="点击切换 升序/降序/默认"
                  >
                    {sameDay ? "当日涨跌(%)" : "区间涨跌(%)"}
                    <span className="sort-ind">
                      {sortDir === "desc" ? "▼" : sortDir === "asc" ? "▲" : "⇅"}
                    </span>
                  </button>
                </th>
                <th className="num">最新净值(元)</th>
                <th className="num">成交额(亿元)</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((p) => (
                <tr key={productKey(p.firm, p.code)}>
                  <td>{INSTITUTION_LABEL[p.firm]}</td>
                  <td className="mono">{p.code}</td>
                  <td>{displayEtfName(p.code, p.name)}</td>
                  <td className={`num ${pctClass(p.rangePct ?? 0)}`}>
                    {p.rangePct == null ? "—" : formatPct(p.rangePct)}
                  </td>
                  <td className="num mono">
                    {endMap.get(productKey(p.firm, p.code))?.nav != null
                      ? `${endMap.get(productKey(p.firm, p.code))!.nav!.toFixed(4)}`
                      : "—"}
                  </td>
                  <td className="num">
                    {p.amount != null ? p.amount.toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
              {!sortedRows.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    没有匹配的产品，试试换公司或代码
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RankTable({
  title,
  unit,
  rows,
  plain,
}: {
  title: string;
  unit: string;
  rows: Array<{ code: string; name: string; value: number }>;
  plain?: boolean;
}) {
  return (
    <div className="rank-card">
      <h3>
        {title}
        <span className="unit-label">（{unit}）</span>
      </h3>
      <table className="data-table compact">
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.code}>
              <td title={displayEtfName(r.code, r.name)}>
                {displayEtfName(r.code, r.name)}
              </td>
              <td
                className={`num${plain ? "" : ` ${r.value >= 0 ? "up" : "down"}`}`}
              >
                {Number(r.value).toFixed(2)}
              </td>
            </tr>
          ))}
          {!rows?.length ? (
            <tr>
              <td className="muted">暂无</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
