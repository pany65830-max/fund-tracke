import { useEffect, useMemo, useState } from "react";
import type { DaySnapshot } from "../lib/schema";
import { INSTITUTION_LABEL } from "../lib/labels";
import { formatPct, pctClass } from "../lib/format";
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
};

function productKey(firm: string, code: string) {
  return `${firm}::${code}`;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addKey, setAddKey] = useState("");
  const [rangeStart, setRangeStart] = useState(asOfDate);
  const [rangeEnd, setRangeEnd] = useState(asOfDate);
  const [startSnap, setStartSnap] = useState<DaySnapshot | null>(null);
  const [endSnap, setEndSnap] = useState<DaySnapshot | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [pickerMsg, setPickerMsg] = useState<string | null>(null);

  useEffect(() => {
    setSelected(new Set(allProducts.map((p) => productKey(p.firm, p.code))));
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
    const q = codeQuery.trim();
    return allProducts.filter((p) => {
      if (firmFilter !== "all" && p.firm !== firmFilter) return false;
      if (!q) return true;
      return p.code.includes(q) || p.name.includes(q);
    });
  }, [allProducts, firmFilter, codeQuery]);

  useEffect(() => {
    const first = dropdownOptions[0];
    setAddKey(first ? productKey(first.firm, first.code) : "");
  }, [dropdownOptions]);

  const addSelectedFromDropdown = () => {
    setPickerMsg(null);
    if (!addKey) {
      setPickerMsg("当前筛选下没有可添加的产品");
      return;
    }
    setSelected((prev) => new Set(prev).add(addKey));
  };

  const searchAndAddByCode = () => {
    setPickerMsg(null);
    const q = codeQuery.trim();
    if (!q) {
      setPickerMsg("请输入基金代码");
      return;
    }
    const hits = allProducts.filter((p) => p.code === q || p.code.includes(q));
    const exact = hits.filter((p) => p.code === q);
    const list = exact.length ? exact : hits;
    if (!list.length) {
      setPickerMsg(`未找到代码含「${q}」的产品`);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of list) next.add(productKey(p.firm, p.code));
      return next;
    });
    setPickerMsg(
      list.length === 1
        ? `已添加 ${list[0].code} ${list[0].name}`
        : `已添加 ${list.length} 只匹配产品`,
    );
  };

  const removeOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const clearAll = () => setSelected(new Set());
  const addAllInFirm = () => {
    const list =
      firmFilter === "all"
        ? allProducts
        : allProducts.filter((p) => p.firm === firmFilter);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of list) next.add(productKey(p.firm, p.code));
      return next;
    });
  };

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

  const selectedProducts = allProducts.filter((p) =>
    selected.has(productKey(p.firm, p.code)),
  );
  const resultRows = selectedProducts.map((p) => {
    const key = productKey(p.firm, p.code);
    const pct = rangeReturnPct(startMap.get(key), endMap.get(key), sameDay);
    return { ...p, rangePct: pct };
  });

  const onRangeChange = (which: "start" | "end", value: string) => {
    if (!value) return;
    if (availableDates.length && !availableDates.includes(value)) {
      setRangeError(`${value} 暂无存档`);
      return;
    }
    if (which === "start") setRangeStart(value);
    else setRangeEnd(value);
  };

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
            <span>结束日（与起始日相同 = 单日）</span>
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

        <div className="product-picker">
          <div className="etf-toolbar compact">
            <label className="field">
              <span>公司</span>
              <select
                value={firmFilter}
                onChange={(e) =>
                  setFirmFilter(e.target.value as "all" | Firm)
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
            <label className="field grow">
              <span>产品下拉</span>
              <select
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
              >
                {!dropdownOptions.length ? (
                  <option value="">无匹配产品</option>
                ) : (
                  dropdownOptions.map((p) => (
                    <option key={productKey(p.firm, p.code)} value={productKey(p.firm, p.code)}>
                      {INSTITUTION_LABEL[p.firm]} · {p.code} · {p.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className="field">
              <span>&nbsp;</span>
              <button type="button" className="btn-primary" onClick={addSelectedFromDropdown}>
                添加
              </button>
            </div>
          </div>

          <div className="etf-toolbar compact">
            <label className="field grow">
              <span>代码精确搜索</span>
              <input
                type="text"
                placeholder="例如 512760"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchAndAddByCode();
                }}
              />
            </label>
            <div className="field">
              <span>&nbsp;</span>
              <button type="button" onClick={searchAndAddByCode}>
                搜索添加
              </button>
            </div>
            <div className="field">
              <span>&nbsp;</span>
              <button type="button" onClick={addAllInFirm}>
                添加该公司全部
              </button>
            </div>
            <div className="field">
              <span>&nbsp;</span>
              <button type="button" onClick={clearAll}>
                清空已选
              </button>
            </div>
          </div>
          {pickerMsg ? <p className="muted picker-msg">{pickerMsg}</p> : null}

          {selectedProducts.length ? (
            <div className="selected-chips">
              {selectedProducts.map((p) => {
                const key = productKey(p.firm, p.code);
                return (
                  <button
                    key={key}
                    type="button"
                    className="chip"
                    onClick={() => removeOne(key)}
                    title="点击移除"
                  >
                    {INSTITUTION_LABEL[p.firm]} {p.code}
                    <span className="chip-x">×</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted">尚未选择产品，请用下拉或代码搜索添加</p>
          )}
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
                <th className="num">{sameDay ? "当日涨跌" : "区间涨跌"}</th>
                <th className="num">最新净值</th>
                <th className="num">成交额</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.map((p) => (
                <tr key={productKey(p.firm, p.code)}>
                  <td>{INSTITUTION_LABEL[p.firm]}</td>
                  <td className="mono">{p.code}</td>
                  <td>{p.name}</td>
                  <td className={`num ${pctClass(p.rangePct ?? 0)}`}>
                    {p.rangePct == null ? "—" : formatPct(p.rangePct)}
                  </td>
                  <td className="num mono">
                    {endMap.get(productKey(p.firm, p.code))?.nav?.toFixed(4) ?? "—"}
                  </td>
                  <td className="num">{p.amount != null ? p.amount.toFixed(2) : "—"}</td>
                </tr>
              ))}
              {!resultRows.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    请先添加要对比的产品
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
