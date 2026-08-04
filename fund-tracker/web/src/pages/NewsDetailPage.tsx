import { Link, useParams, useSearchParams } from "react-router-dom";
import type { DaySnapshot } from "../lib/schema";
import { CATEGORY_LABEL, INSTITUTION_LABEL, SOURCE_LABEL } from "../lib/labels";

export function NewsDetailPage({ snap }: { snap: DaySnapshot }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const date = params.get("date") || snap.tradeDate;
  const item = snap.news.find((n) => n.id === id);

  if (!item) {
    return (
      <div className="card">
        <p>未找到文章</p>
        <Link to={`/?date=${date}`}>返回列表</Link>
      </div>
    );
  }

  return (
    <article className="card">
      <Link to={`/?date=${date}`}>← 返回列表</Link>
      <h1 style={{ marginTop: 12 }}>{item.title}</h1>
      <div>
        <span className="tag">{INSTITUTION_LABEL[item.institution]}</span>
        <span className="tag type">{CATEGORY_LABEL[item.category]}</span>
        <span className="muted">{SOURCE_LABEL[item.source]}</span>
      </div>
      <p className="muted">{item.publishedAt}</p>
      {item.body ? (
        <div className="article-body">{item.body}</div>
      ) : (
        <p>{item.summary || "暂无全文，请阅读原文。"}</p>
      )}
      <p style={{ marginTop: 20 }}>
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
          阅读原文
        </a>
      </p>
    </article>
  );
}
