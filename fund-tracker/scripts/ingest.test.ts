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
});
