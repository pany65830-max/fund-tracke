import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaySnapshotSchema } from "../shared/schema";
import { runIngest } from "./ingest";

describe("runIngest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ft-ingest-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes validated fixture snapshot", async () => {
    const snap = await runIngest({
      tradeDate: "2026-08-03",
      dataDir: dir,
      useFixture: true,
    });
    expect(snap.status).toBe("ok");
    expect(existsSync(join(dir, "2026-08-03.json"))).toBe(true);
    expect(existsSync(join(dir, "latest.json"))).toBe(true);
    const raw = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    expect(DaySnapshotSchema.safeParse(raw).success).toBe(true);
  });

  it("keeps previous latest when ingest fully fails", async () => {
    const { writeFileSync } = await import("node:fs");
    const good = {
      tradeDate: "2026-08-03",
      updatedAt: "2026-08-03T00:00:00.000Z",
      status: "ok",
      news: [
        {
          id: "keep-1",
          title: "保留",
          summary: "",
          institution: "huatai",
          category: "other",
          source: "ifind",
          publishedAt: "2026-08-03T08:00:00+08:00",
          sourceUrl: "https://www.huatai-pb.com/",
        },
      ],
      etf: {
        indices: [{ code: "000300", name: "沪深300", last: 1, changePct: 0 }],
        sectors: [],
        hotInflow: [],
        hotGainers: [],
        hotTurnover: [],
        productsByFirm: {},
      },
    };
    writeFileSync(join(dir, "latest.json"), JSON.stringify(good), "utf8");
    writeFileSync(join(dir, "2026-08-03.json"), JSON.stringify(good), "utf8");

    const { writeSnapshot } = await import("./write-snapshot");
    writeSnapshot(dir, {
      tradeDate: "2026-08-04",
      updatedAt: "2026-08-04T00:00:00.000Z",
      status: "failed",
      errors: ["ifind-news: network"],
      news: [],
      etf: {
        indices: [],
        sectors: [],
        hotInflow: [],
        hotGainers: [],
        hotTurnover: [],
        productsByFirm: {},
      },
    });

    const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    expect(latest.tradeDate).toBe("2026-08-03");
    expect(latest.news[0].id).toBe("keep-1");
    expect(existsSync(join(dir, "2026-08-04.json"))).toBe(true);
  });
});
