import type { DaySnapshot } from "../lib/schema";
import { INSTITUTION_LABEL } from "../lib/labels";
import { formatPct, pctClass } from "../lib/format";

export function EtfPage({ snap }: { snap: DaySnapshot }) {
  const { etf } = snap;
  const firms = ["huaxia", "efunds", "guotai", "huatai"] as const;

  return (
    <div>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>行情概览</h2>
        <div className="grid-3">
          {etf.indices.map((idx) => (
            <div key={idx.code}>
              <div className="muted">{idx.name}</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{idx.last}</div>
              <div className={pctClass(idx.changePct)}>{formatPct(idx.changePct)}</div>
            </div>
          ))}
          {!etf.indices.length ? <p className="muted">暂无指数数据</p> : null}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>板块/主题表现</h2>
        <div className="grid-sectors">
          {etf.sectors.map((s) => (
            <div key={s.name} style={{ textAlign: "center", padding: 8 }}>
              <div>{s.name}</div>
              <div className={pctClass(s.changePct)}>{formatPct(s.changePct)}</div>
            </div>
          ))}
          {!etf.sectors.length ? <p className="muted">暂无板块数据</p> : null}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>热榜</h2>
        <div className="grid-3">
          <RankTable title="净流入" rows={etf.hotInflow} />
          <RankTable title="涨幅" rows={etf.hotGainers} />
          <RankTable title="成交额" rows={etf.hotTurnover} />
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>产品列表（四家公司）</h2>
        {firms.map((firm) => {
          const rows = etf.productsByFirm[firm] || [];
          return (
            <div key={firm} style={{ marginBottom: 16 }}>
              <h3>{INSTITUTION_LABEL[firm]}</h3>
              <table>
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>涨跌</th>
                    <th>成交额</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p: { code: string; name: string; changePct: number; amount?: number }) => (
                    <tr key={p.code}>
                      <td>{p.code}</td>
                      <td>{p.name}</td>
                      <td className={pctClass(p.changePct)}>{formatPct(p.changePct)}</td>
                      <td>{p.amount ?? "-"}</td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        暂无产品
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          );
        })}
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
    <div>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table>
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.code}>
              <td>{r.name}</td>
              <td className={r.value >= 0 ? "up" : "down"}>{r.value}</td>
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
