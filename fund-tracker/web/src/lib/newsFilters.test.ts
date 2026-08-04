import { describe, it, expect } from "vitest";
import { filterNews } from "./newsFilters";
import type { NewsItem } from "./schema";

const sample: NewsItem[] = [
  {
    id: "1",
    title: "a",
    summary: "",
    institution: "huatai",
    category: "research",
    source: "ifind",
    publishedAt: "t",
    sourceUrl: "https://example.com/1",
  },
  {
    id: "2",
    title: "b",
    summary: "",
    institution: "sse",
    category: "exchange",
    source: "exchange_web",
    publishedAt: "t",
    sourceUrl: "https://example.com/2",
  },
];

describe("filterNews", () => {
  it("filters by institution and category", () => {
    expect(
      filterNews(sample, { institution: "huatai", category: "all" }),
    ).toHaveLength(1);
    expect(
      filterNews(sample, { institution: "all", category: "exchange" }),
    ).toHaveLength(1);
  });
});
