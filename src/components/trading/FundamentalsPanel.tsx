import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, RefreshCw, Flame, Info, Loader2, History, Sparkles } from "lucide-react";
import { getMarketCalendar } from "@/lib/fundamentals.functions";
import { countdown, nextEvent, pairCurrencies, type Impact, type MarketEvent } from "@/lib/fundamentals";
import { usePortalStore } from "@/lib/portal-store";

type CalendarData = Awaited<ReturnType<typeof getMarketCalendar>>;
const CACHE_KEY = "algo:calendar-cache";

export const calendarQuery = queryOptions({
  queryKey: ["market-calendar"],
  queryFn: async (): Promise<CalendarData> => {
    const data = await getMarketCalendar();
    if (data.ok && typeof window !== "undefined") {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
    }
    return data;
  },
  staleTime: 5 * 60_000,
});

/** Shows the last saved calendar instantly, then refreshes it in the background as soon as the app opens. */
export function useWarmCalendar() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!qc.getQueryData(calendarQuery.queryKey)) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        const saved = raw ? (JSON.parse(raw) as CalendarData) : null;
        if (saved?.ok && Array.isArray(saved.events)) qc.setQueryData(calendarQuery.queryKey, saved, { updatedAt: saved.updatedAt || 1 });
      } catch { /* bad cache */ }
    }
    void qc.prefetchQuery(calendarQuery);
  }, [qc]);
}

type Filter = "all" | "high" | "medium" | "pairs";
type When = "upcoming" | "passed";
const IMPACT_STYLE: Record<Impact, string> = {
  High: "bg-destructive text-destructive-foreground shadow-[0_0_12px_color-mix(in_oklab,var(--destructive)_60%,transparent)]",
  Medium: "bg-primary/80 text-primary-foreground",
  Low: "bg-muted text-muted-foreground",
  Holiday: "bg-secondary text-secondary-foreground",
};
const IMPACT_DOT: Record<Impact, string> = { High: "bg-destructive", Medium: "bg-primary", Low: "bg-muted-foreground", Holiday: "bg-secondary-foreground" };

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function FundamentalsPanel() {
  useWarmCalendar();
  const { data, isFetching } = useQuery(calendarQuery);
  const qc = useQueryClient();
  const now = useNow();
  const { eas, activeEAId } = usePortalStore();
  const [when, setWhen] = useState<When>("upcoming");
  const [filter, setFilter] = useState<Filter>("all");
  const [currency, setCurrency] = useState<string>("*");
  const events = data?.events ?? [];

  const myCurrencies = useMemo(() => {
    const ea = eas.find((e) => e.id === activeEAId) ?? eas[0];
    return [...new Set((ea?.symbols ?? []).map((s) => s.symbol).flatMap(pairCurrencies))];
  }, [eas, activeEAId]);
  const currencies = useMemo(() => ["*", ...[...new Set(events.map((e) => e.currency))].sort()], [events]);

  const isPassed = (e: MarketEvent) => now !== null && Date.parse(e.time) < now;
  const upcomingCount = now === null ? 0 : events.filter((e) => !isPassed(e)).length;
  const passedCount = now === null ? 0 : events.length - upcomingCount;

  const visible = useMemo(() => {
    const list = events.filter((e) => {
      if (filter === "high" && e.impact !== "High") return false;
      if (filter === "medium" && e.impact !== "High" && e.impact !== "Medium") return false;
      if (filter === "pairs" && !myCurrencies.includes(e.currency)) return false;
      if (currency !== "*" && e.currency !== currency) return false;
      if (now !== null && (when === "passed") !== (Date.parse(e.time) < now)) return false;
      return true;
    });
    return when === "passed" ? [...list].reverse() : list;
  }, [events, filter, currency, when, now, myCurrencies]);

  const days = useMemo(() => {
    const map = new Map<string, MarketEvent[]>();
    for (const e of visible) {
      const key = new Date(e.time).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [visible]);

  const nextHigh = now !== null ? nextEvent(events, now, true) : null;
  const highLeft = now !== null ? events.filter((e) => e.impact === "High" && Date.parse(e.time) > now).length : 0;

  const pill = (active: boolean) =>
    `h-9 px-4 rounded-full text-sm font-semibold border transition-all whitespace-nowrap shrink-0 ${active ? "bg-primary text-primary-foreground border-primary shadow-[0_0_14px_color-mix(in_oklab,var(--primary)_55%,transparent)]" : "bg-card/70 text-muted-foreground border-border"}`;

  return (
    <div className="px-4 pt-5 pb-28 space-y-4 text-foreground">
      <header className="flex items-center gap-3">
        <span className="size-11 rounded-full grid place-items-center bg-primary/15 border border-primary/60 shadow-[0_0_18px_color-mix(in_oklab,var(--primary)_50%,transparent)]">
          <CalendarClock className="size-5 text-primary" />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-tight">Fundamentals</h1>
          <p className="text-xs text-foreground/80">This week's market news</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: calendarQuery.queryKey })}
          disabled={isFetching}
          aria-label="Refresh news"
          className="size-10 rounded-full grid place-items-center bg-card/70 border border-border"
        >
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>

      {!data && (
        <div className="py-16 grid place-items-center text-muted-foreground gap-2">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm">Loading this week's events…</p>
        </div>
      )}
      {data && !data.ok && <div className="rounded-3xl border border-destructive/40 bg-destructive/10 p-4 text-sm">{data.error}</div>}

      {data && (
        <>
          <section className="rounded-[28px] border border-primary/50 bg-card/80 p-4 shadow-[0_0_24px_color-mix(in_oklab,var(--primary)_25%,transparent)]">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Flame className="size-3.5 text-destructive" />Next high-impact news</p>
            {nextHigh && now !== null ? (
              <>
                <p className="mt-2 text-xl font-bold">{nextHigh.currency} · {nextHigh.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-background/70 text-foreground border border-border px-3 py-1">{new Date(nextHigh.time).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="rounded-full bg-primary text-primary-foreground px-3 py-1 font-bold shadow-[0_0_12px_color-mix(in_oklab,var(--primary)_60%,transparent)]">{countdown(nextHigh.time, now)}</span>
                </div>
                {(nextHigh.forecast || nextHigh.previous) && <p className="text-sm mt-3">Forecast <b>{nextHigh.forecast || "—"}</b> · Previous <b>{nextHigh.previous || "—"}</b></p>}
                <p className="text-xs text-muted-foreground mt-3">{highLeft} high-impact event{highLeft === 1 ? "" : "s"} left this week. Prices can jump hard around these times.</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{now === null ? "Loading…" : "No more high-impact news this week."}</p>
            )}
          </section>

          <div className="grid grid-cols-2 gap-2 rounded-full bg-card/70 border border-border p-1" role="group" aria-label="Upcoming or passed">
            <button onClick={() => setWhen("upcoming")} className={`h-11 rounded-full text-sm font-bold flex items-center justify-center gap-2 transition-all ${when === "upcoming" ? "bg-primary text-primary-foreground shadow-[0_0_16px_color-mix(in_oklab,var(--primary)_60%,transparent)]" : "text-muted-foreground"}`}>
              <Sparkles className="size-4" />Upcoming <span className="rounded-full bg-background/30 px-2 text-xs">{upcomingCount}</span>
            </button>
            <button onClick={() => setWhen("passed")} className={`h-11 rounded-full text-sm font-bold flex items-center justify-center gap-2 transition-all ${when === "passed" ? "bg-primary text-primary-foreground shadow-[0_0_16px_color-mix(in_oklab,var(--primary)_60%,transparent)]" : "text-muted-foreground"}`}>
              <History className="size-4" />Passed <span className="rounded-full bg-background/30 px-2 text-xs">{passedCount}</span>
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Impact filter">
            <button className={pill(filter === "all")} onClick={() => setFilter("all")}>All</button>
            <button className={pill(filter === "high")} onClick={() => setFilter("high")}>High only</button>
            <button className={pill(filter === "medium")} onClick={() => setFilter("medium")}>Medium+</button>
            {myCurrencies.length > 0 && <button className={pill(filter === "pairs")} onClick={() => setFilter("pairs")}>My pairs</button>}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Currency filter">
            {currencies.map((c) => <button key={c} className={pill(currency === c)} onClick={() => setCurrency(c)}>{c === "*" ? "All currencies" : c === "ALL" ? "Global" : c}</button>)}
          </div>

          {days.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">{when === "upcoming" ? "No upcoming events match these filters." : "No passed events match these filters."}</p>}

          {days.map(([day, list]) => (
            <section key={day} className="space-y-2">
              <h2 className="inline-flex rounded-full bg-card/90 border border-border px-3 py-1 text-xs font-bold uppercase tracking-widest text-foreground mt-2">{day}</h2>
              {list.map((e) => {
                const past = isPassed(e);
                return (
                  <article key={e.id} className={`rounded-3xl border bg-card/80 p-3 flex gap-3 ${e.impact === "High" && !past ? "border-destructive/50 shadow-[0_0_14px_color-mix(in_oklab,var(--destructive)_20%,transparent)]" : "border-border"} ${past ? "opacity-70" : ""}`}>
                    <div className="w-[4.5rem] shrink-0 grid place-items-center rounded-2xl bg-muted/60 py-2">
                      <p className="text-sm font-bold whitespace-nowrap">{new Date(e.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>
                      <p className="text-xs font-bold text-primary mt-0.5 flex items-center gap-1"><span className={`size-2 rounded-full ${IMPACT_DOT[e.impact]}`} />{e.currency}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className="font-semibold leading-snug flex-1">{e.title}</p>
                        <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${IMPACT_STYLE[e.impact]}`}>{e.impact}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
                        <span>Forecast <b className="text-foreground">{e.forecast || "—"}</b></span>
                        <span>Previous <b className="text-foreground">{e.previous || "—"}</b></span>
                        {now !== null && <span className={`ml-auto font-semibold rounded-full px-2 ${past ? "bg-muted" : "bg-primary/15 text-primary"}`}>{past ? "Passed" : countdown(e.time, now)}</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          ))}

          <p className="text-xs text-muted-foreground flex gap-2 pt-2"><Info className="size-4 shrink-0" />Times are in your phone's time zone. Calendar from Forex Factory, refreshed every few minutes. Gold (XAU) reacts mostly to USD news.</p>
        </>
      )}
    </div>
  );
}
