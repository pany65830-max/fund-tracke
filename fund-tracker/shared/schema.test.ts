import { describe, it, expect } from "vitest";
import { DaySnapshotSchema } from "./schema";

describe("DaySnapshotSchema", () => {
  it("accepts a minimal valid snapshot", () => {
    const parsed = DaySnapshotSchema.parse({
      tradeDate: "2026-08-03",
      updatedAt: "2026-08-03T08:30:00+08:00",
      status: "ok",
      news: [
        {
          id: "n1",
          title: "示例研报",
          summary: "摘要",
          institution: "huatai",
          category: "research",
          source: "ifind",
          publishedAt: "2026-08-03T07:00:00+08:00",
          sourceUrl: "https://example.com/a",
        },
      ],
      etf: {
        indices: [],
        sectors: [],
        hotInflow: [],
        hotGainers: [],
        hotTurnover: [],
        productsByFirm: {},
      },
    });
    expect(parsed.tradeDate).toBe("2026-08-03");
  });
});
