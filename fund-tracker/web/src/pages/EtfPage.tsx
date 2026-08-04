import { useEffect, useMemo, useState } from "react";
import type { DaySnapshot } from "../lib/schema";
import { INSTITUTION_LABEL } from "../lib/labels";
import { formatPct, pctClass } from "../lib/format";
import { loadSnapshot } from "../lib/loadData";
import { flattenProducts, rangeReturnPct } from "../lib/rangeReturn";

const FIRMS = ["huaxia", "efunds", "guotai", "huatai"] as const;

type ProductRow = {
  code: string;
  name: string;
  changePct: number;
  amount?: number;
  nav?: number;
};

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
    const rows: Array<ProductRow & { firm: (typeof FIRMS)[number] }> = [];
    for (const firm of FIRMS) {
      for (const p of (etf.productsByFirm[firm] || []) as ProductRow[]) {
        rows.push({ ...p, firm });
      }
    }
    return rows;
  }, [etf.productsByFirm]);

  const [firmFilter, setFirmFilter] = useState<"all" | (typeof FIRMS)[number]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickStep, setPickStep] = useState<"idle" | "start" | "end">("idle");
  const [rangeStart, setRangeStart] = useState(asOfDate);
  const [rangeEnd, setRangeEnd] = useState(asOfDate);
  const [startSnap, setStartSnap] = useState<DaySnapshot | null>(null);
  const [endSnap, setEndSnap] = useState<DaySnapshot | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Default select all products when data changes
  useEffect(() => {
    setSelected(new Set(allProducts.map((p) => `${p.firm}::${p.code}`)));
  }, [allProducts]);

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
          rangeStart <= rangeEnd
            ? [rangeStart, rangeEnd]
            : [rangeEnd, rangeStart];
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

  const filteredCatalog = allProducts.filter(
    (p) => firmFilter === "all" || p.firm === firmFilter,
  );

  const toggleProduct = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of filteredCatalog) next.add(`${p.firm}::${p.code}`);
      return next;
    });
  };

  const clearVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of filteredCatalog) next.delete(`${p.firm}::${p.code}`);
      return next;
    });
  };

  const onPickDate = (d: string) => {
    if (pickStep === "idle" || pickStep === "end") {
      setRangeStart(d);
      setRangeEnd(d);
      setPickStep("start");
      return;
    }
    // second click
    if (d === rangeStart) {
      setRangeEnd(d);
    } else if (d < rangeStart) {
      setRangeEnd(rangeStart);
      setRangeStart(d);
    } else {
      setRangeEnd(d);
    }
    setPickStep("end");
  };

  const sameDay = rangeStart === rangeEnd;
  const startMap = new Map(
    flattenProducts(startSnap?.etf.productsByFirm || {}).map((p) => [
      `${p.firm}::${p.code}`,
      p,
    ]),
  );
  const endMap = new Map(
    flattenProducts(endSnap?.etf.productsByFirm || {}).map((p) => [
      `${p.firm}::${p.code}`,
      p,
    ]),
  );

  const resultRows = allProducts
    .filter((p) => selected.has(`${p.firm}::${p.code}`))
    .map((p) => {
      const key = `${p.firm}::${p.code}`;
      const pct = rangeReturnPct(startMap.get(key), endMap.get(key), sameDay);
      return { ...p, rangePct: pct };
    });

  return (
    <div className="etf-page">
      <section className="card">
        <div className="section-head">
          <h2>行情概览</h2>
          <span className="muted">截至 {snap.tradeDate}</span>
        </div>
        <div className="index-grid">
          {etf.indices.map((idx) => (
            <div key={idx.code} className="index-tile">
              <div className="index-name">{idx.name}</div>
              <div className="index-last">{idx.last.toFixed(2)}</div>
              <div className={`index-chg ${pctClass(idx.changePct)}`}>
                {formatPct(idx.changePct)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>板块 / 主题</h2>
        </div>
        <div className="sector-grid">
          {etf.sectors.map((s) => (
            <div key={s.name} className="sector-tile">
              <div>{s.name}</div>
              <div className={pctClass(s.changePct)}>{formatPct(s.changePct)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>热榜</h2>
        </div>
        <div className="hot-grid">
          <RankTable title="净流入" rows={etf.hotInflow} />
          <RankTable title="涨幅" rows={etf.hotGainers} />
          <RankTable title="成交额" rows={etf.hotTurnover} />
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>产品涨跌对比</h2>
          <span className="muted">
            {sameDay
              ? `单日 ${rangeStart}`
              : `区间 ${rangeStart} → ${rangeEnd}`}
          </span>
        </div>

        <div className="etf-toolbar">
          <label className="field">
            <span>公司筛选</span>
            <select
              value={firmFilter}
              onChange={(e) =>
                setFirmFilter(e.target.value as "all" | (typeof FIRMS)[number])
              }
            >
              <option value="all">全部公司</option>
              {FIRMS.map((f) => (
                <option key={f} value={f}>
                  {INSTITUTION_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>区间选择</span>
            <div className="range-pick">
              <button
                type="button"
                className={pickStep !== "idle" ? "btn-primary" : ""}
                onClick={() => setPickStep(pickStep === "idle" ? "start" : "idle")}
              >
                {pickStep === "idle"
                  ? "点选起止日期"
                  : pickStep === "start"
                    ? "请点起始日…"
                    : "可再点结束日"}
              </button>
              <span className="muted tip">
                点两次同一天 = 只看当天；也可直接改下方日期
              </span>
            </div>
          </div>
        </div>

        {pickStep !== "idle" ? (
          <div className="date-chip-row">
            {availableDates.map((d) => (
              <button
                key={d}
                type="button"
                className={
                  "date-chip" +
                  (d === rangeStart || d === rangeEnd ? " active" : "")
                }
                onClick={() => onPickDate(d)}
              >
                {d.slice(5)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="etf-toolbar compact">
          <label className="field">
            <span>起始日</span>
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => {
                setRangeStart(e.target.value);
                setPickStep("end");
              }}
            />
          </label>
          <label className="field">
            <span>结束日</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => {
                setRangeEnd(e.target.value);
                setPickStep("end");
              }}
            />
          </label>
        </div>

        <div className="product-filter">
          <div className="filter-actions">
            <strong>勾选产品（类似 Excel 筛选）</strong>
            <div>
              <button type="button" onClick={selectAllVisible}>
                全选当前
              </button>
              <button type="button" onClick={clearVisible}>
                清空当前
              </button>
            </div>
          </div>
          <div className="product-check-grid">
            {filteredCatalog.map((p) => {
              const key = `${p.firm}::${p.code}`;
              return (
                <label key={key} className="check-item">
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggleProduct(key)}
                  />
                  <span className="check-firm">{INSTITUTION_LABEL[p.firm]}</span>
                  <span className="check-code">{p.code}</span>
                  <span className="check-name">{p.name}</span>
                </label>
              );
            })}
          </div>
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
                  {sameDay ? "当日涨跌" : "区间涨跌"}
                </th>
                <th className="num">最新净值</th>
                <th className="num">成交额</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.map((p) => (
                <tr key={`${p.firm}-${p.code}`}>
                  <td>{INSTITUTION_LABEL[p.firm]}</td>
                  <td className="mono">{p.code}</td>
                  <td>{p.name}</td>
                  <td className={`num ${pctClass(p.rangePct ?? 0)}`}>
                    {p.rangePct == null ? "—" : formatPct(p.rangePct)}
                  </td>
                  <td className="num mono">
                    {endMap.get(`${p.firm}::${p.code}`)?.nav?.toFixed(4) ?? "—"}
                  </td>
                  <td className="num">
                    {p.amount != null ? p.amount.toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
              {!resultRows.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    请至少勾选一只产品
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
  rows,
}: {
  title: string;
  rows: Array<{ code: string; name: string; value: number }>;
}) {
  return (
    <div className="rank-card">
      <h3>{title}</h3>
      <table className="data-table compact">
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.code}>
              <td>{r.name}</td>
              <td className={`num ${r.value >= 0 ? "up" : "down"}`}>{r.value}</td>
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
