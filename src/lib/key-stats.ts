/** Pure licence-key statistics for the mentor Key Stats page. */
export interface KeyRecord {
  key: string;
  userName: string;
  ea: string;
  duration: string;
  createdAt: number;
  active: boolean;
}

const DAY = 86_400_000;

export function durationName(duration: string): string {
  const d = duration.trim().toUpperCase();
  if (d.includes("LIFETIME") || d.startsWith("∞")) return "Lifetime";
  const [n, unit = ""] = d.split(/\s+/);
  const u = unit.charAt(0) + unit.slice(1).toLowerCase();
  return `${n} ${u}`.trim();
}

function countBy(items: KeyRecord[], pick: (k: KeyRecord) => string) {
  const map = new Map<string, number>();
  for (const k of items) map.set(pick(k), (map.get(pick(k)) ?? 0) + 1);
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function keyStats(keys: KeyRecord[], now = Date.now()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const today0 = startToday.getTime();
  const month0 = new Date(startToday.getFullYear(), startToday.getMonth(), 1).getTime();
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = today0 - (6 - i) * DAY;
    return {
      start,
      label: new Date(start).toLocaleDateString(undefined, { weekday: "short" }),
      count: keys.filter((k) => k.createdAt >= start && k.createdAt < start + DAY).length,
    };
  });
  return {
    total: keys.length,
    active: keys.filter((k) => k.active).length,
    inactive: keys.filter((k) => !k.active).length,
    today: keys.filter((k) => k.createdAt >= today0).length,
    last7: days.reduce((s, d) => s + d.count, 0),
    thisMonth: keys.filter((k) => k.createdAt >= month0).length,
    clients: new Set(keys.map((k) => k.userName.trim().toLowerCase()).filter(Boolean)).size,
    byEa: countBy(keys, (k) => k.ea || "Unknown"),
    byDuration: countBy(keys, (k) => durationName(k.duration)),
    days,
    recent: [...keys].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
  };
}
