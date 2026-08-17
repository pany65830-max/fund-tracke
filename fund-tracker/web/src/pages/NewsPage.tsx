import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DaySnapshot, Institution, NewsCategory } from "../lib/schema";
import { filterNews } from "../lib/newsFilters";
import { CATEGORY_LABEL, INSTITUTION_LABEL, SOURCE_LABEL } from "../lib/labels";

export function NewsPage({ snap }: { snap: DaySnapshot }) {
  const [institution, setInstitution] = useState<Institution | "all">("all");
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const items = useMemo(
    () => filterNews(snap.news, { institution, category, tradeDate: snap.tradeDate }),
    [snap.news, institution, category, snap.tradeDate],
  );
  const q = `?date=${snap.tradeDate}`;

  return (
    <div>
      <div className="filters">
        <select
          value={institution}
          onChange={(e) => setInstitution(e.target.value as Institution | "all")}
        >
          <option value="all">全部机构</option>
          {(Object.keys(INSTITUTION_LABEL) as Institution[]).map((k) => (
            <option key={k} value={k}>
              {INSTITUTION_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as NewsCategory | "all")}
        >
          <option value="all">全部类型</option>
          {(Object.keys(CATEGORY_LABEL) as NewsCategory[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      {items.map((n, idx) => (
        // 用 id+序号 作为 React key：历史数据里微信资讯存在重复 id，
        // 纯按 id 作 key 会导致切换日期时旧卡片残留（React 按 key 复用出错）
        <article key={`${n.id}:${idx}`} className="card">
          <div>
            <span className="tag">{INSTITUTION_LABEL[n.institution]}</span>
            <span className="tag type">{CATEGORY_LABEL[n.category]}</span>
            <span className="muted">{SOURCE_LABEL[n.source]}</span>
          </div>
          <h3 style={{ margin: "8px 0 4px" }}>
            <Link to={`/news/${encodeURIComponent(n.id)}${q}`}>{n.title}</Link>
          </h3>
          <p className="muted" style={{ margin: 0 }}>
            {n.summary}
          </p>
          <div className="muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>
            {n.publishedAt}
          </div>
        </article>
      ))}
      {!items.length ? <p className="muted">当日无匹配资讯</p> : null}
    </div>
  );
}
