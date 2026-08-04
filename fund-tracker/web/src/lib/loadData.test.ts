import { describe, it, expect, vi, afterEach } from "vitest";
import { loadSnapshot } from "./loadData";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSnapshot", () => {
  it("parses json via fetch", async () => {
    const body = {
      tradeDate: "2026-08-03",
      updatedAt: "x",
      status: "ok",
      news: [],
      etf: {
        indices: [],
        sectors: [],
        hotInflow: [],
        hotGainers: [],
        hotTurnover: [],
        productsByFirm: {},
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    const snap = await loadSnapshot("2026-08-03");
    expect(snap.tradeDate).toBe("2026-08-03");
  });
});
