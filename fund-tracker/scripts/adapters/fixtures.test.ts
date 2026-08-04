import { describe, it, expect } from "vitest";
import { DaySnapshotSchema, NewsItemSchema, EtfDashboardSchema } from "../../shared/schema";
import { createFixtureEtfAdapter, createFixtureNewsAdapter } from "./fixtures";

describe("fixtures", () => {
  it("news fixture validates", async () => {
    const items = await createFixtureNewsAdapter().fetchNews("2026-08-03");
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(NewsItemSchema.array().parse(items)).toHaveLength(items.length);
  });

  it("etf fixture validates", async () => {
    const etf = await createFixtureEtfAdapter().fetchEtf("2026-08-03");
    expect(EtfDashboardSchema.parse(etf).indices.length).toBeGreaterThan(0);
  });

  it("can form a day snapshot", async () => {
    const news = await createFixtureNewsAdapter().fetchNews("2026-08-03");
    const etf = await createFixtureEtfAdapter().fetchEtf("2026-08-03");
    expect(
      DaySnapshotSchema.parse({
        tradeDate: "2026-08-03",
        updatedAt: "2026-08-03T08:30:00+08:00",
        status: "ok",
        news,
        etf,
      }).status,
    ).toBe("ok");
  });
});
