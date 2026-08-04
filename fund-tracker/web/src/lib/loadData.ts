import { DaySnapshotSchema, type DaySnapshot } from "./schema";

export async function loadLatest(): Promise<DaySnapshot> {
  const res = await fetch("/data/latest.json");
  if (!res.ok) throw new Error(`latest.json HTTP ${res.status}`);
  return DaySnapshotSchema.parse(await res.json());
}

export async function loadSnapshot(date: string): Promise<DaySnapshot> {
  const res = await fetch(`/data/${date}.json`);
  if (!res.ok) throw new Error(`${date}.json HTTP ${res.status}`);
  return DaySnapshotSchema.parse(await res.json());
}
