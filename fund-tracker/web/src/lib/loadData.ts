import { DaySnapshotSchema, type DaySnapshot } from "./schema";

/** Resolve data JSON relative to the current page (works with GitHub Pages subpaths). */
function resolveData(path: string): string {
  const normalized = path.replace(/^\//, "");
  if (typeof window === "undefined") return `./${normalized}`;
  return new URL(normalized, window.location.href).toString();
}

export async function loadLatest(): Promise<DaySnapshot> {
  const res = await fetch(resolveData("data/latest.json"));
  if (!res.ok) throw new Error(`latest.json HTTP ${res.status}`);
  return DaySnapshotSchema.parse(await res.json());
}

export async function loadSnapshot(date: string): Promise<DaySnapshot> {
  const res = await fetch(resolveData(`data/${date}.json`));
  if (!res.ok) throw new Error(`${date} 暂无数据（可能非交易日或尚未更新）`);
  return DaySnapshotSchema.parse(await res.json());
}

export async function loadAvailableDates(): Promise<string[]> {
  const res = await fetch(resolveData("data/dates.json"));
  if (!res.ok) return [];
  const raw = await res.json();
  return Array.isArray(raw) ? (raw as string[]).sort() : [];
}
