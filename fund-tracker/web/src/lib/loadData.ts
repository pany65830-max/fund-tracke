import { DaySnapshotSchema, type DaySnapshot } from "./schema";

export async function loadLatest(): Promise<DaySnapshot> {
  const res = await fetch("/data/latest.json");
  if (!res.ok) throw new Error(`latest.json HTTP ${res.status}`);
  return DaySnapshotSchema.parse(await res.json());
}

export async function loadSnapshot(date: string): Promise<DaySnapshot> {
  const res = await fetch(`/data/${date}.json`);
  if (!res.ok) throw new Error(`${date} 暂无数据（可能非交易日或尚未更新）`);
  return DaySnapshotSchema.parse(await res.json());
}

export async function loadAvailableDates(): Promise<string[]> {
  const res = await fetch("/data/dates.json");
  if (!res.ok) return [];
  const raw = await res.json();
  return Array.isArray(raw) ? (raw as string[]).sort() : [];
}
