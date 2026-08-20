import { describe, it, expect } from "vitest";
import { extractDate, parseCompanyLinks } from "./company-web";

describe("company-web dates", () => {
  it("reads dotted date from list context after the link", () => {
    const html = `
      <li>
        <a href="/news/esg.html">华夏基金连续五年发布ESG投资白皮书！一图读懂报告要点</a>
        <p>摘要若干字</p>
        <span>2025.12.17</span>
      </li>`;
    const items = parseCompanyLinks(
      html,
      "https://www.chinaamc.com/hxdt/hxxw/",
      "huaxia",
      "2026-08-19",
      { maxAgeDays: 400, limit: 12 },
    );
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt.startsWith("2025-12-17")).toBe(true);
  });

  it("drops undated homepage evergreen links instead of stamping today", () => {
    const html = `<a href="/about/esg.html">华夏基金连续五年发布ESG投资白皮书！一图读懂报告要点</a>`;
    const items = parseCompanyLinks(
      html,
      "https://www.chinaamc.com/",
      "huaxia",
      "2026-08-19",
    );
    expect(items).toHaveLength(0);
  });

  it("extractDate accepts 2026-08-19 and 2026.08.19", () => {
    expect(extractDate("易方达溢价提示 2026-08-19", "")).toBe("2026-08-19");
    expect(extractDate("新闻 2026.01.01", "")).toBe("2026-01-01");
  });
});
