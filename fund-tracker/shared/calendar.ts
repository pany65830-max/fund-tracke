export function isTradingDay(date: string, holidays: Set<string>): boolean {
  if (holidays.has(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
  return dow !== 0 && dow !== 6;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function previousTradingDay(
  date: string,
  holidays: Set<string>,
): string {
  let cur = addDays(date, -1);
  while (!isTradingDay(cur, holidays)) {
    cur = addDays(cur, -1);
  }
  return cur;
}

export function nextTradingDay(date: string, holidays: Set<string>): string {
  let cur = addDays(date, 1);
  while (!isTradingDay(cur, holidays)) {
    cur = addDays(cur, 1);
  }
  return cur;
}
