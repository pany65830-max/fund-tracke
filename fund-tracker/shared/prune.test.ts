import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneOldSnapshots } from "./prune";

describe("pruneOldSnapshots", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ft-prune-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps only newest N trading days", () => {
    // Mon-Fri week of 2026-07-27 .. 2026-07-31
    for (const d of [
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]) {
      writeFileSync(join(dir, `${d}.json`), "{}");
    }
    const deleted = pruneOldSnapshots(dir, 3, new Set());
    expect(deleted.sort()).toEqual([
      "2026-07-27.json",
      "2026-07-28.json",
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      "2026-07-29.json",
      "2026-07-30.json",
      "2026-07-31.json",
    ]);
  });
});
