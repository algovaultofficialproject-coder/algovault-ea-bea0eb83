import { createServerFn } from "@tanstack/react-start";
import { parseCalendar, type MarketEvent } from "./fundamentals";

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FRESH_MS = 15 * 60_000;
const SAVED_KEY = "news_calendar_cache";
let cache: { at: number; events: MarketEvent[] } | null = null;

type Saved = { at: number; events: MarketEvent[] };

/** Last good calendar shared by every server copy, so a busy feed never empties the News tab. */
async function readSaved(): Promise<Saved | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", SAVED_KEY).maybeSingle();
    if (!data?.value) return null;
    const parsed = JSON.parse(data.value) as Saved;
    return Array.isArray(parsed.events) && typeof parsed.at === "number" ? parsed : null;
  } catch (e) {
    console.error("Saved calendar read failed", e);
    return null;
  }
}

async function writeSaved(saved: Saved) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings")
      .upsert({ key: SAVED_KEY, value: JSON.stringify(saved), updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) console.error("Saved calendar write failed", error.message);
  } catch (e) {
    console.error("Saved calendar write failed", e);
  }
}

async function fetchFeed(): Promise<MarketEvent[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(FEED, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (AlgoVault calendar)" } });
      if (res.ok) return parseCalendar(await res.json());
      console.error(`Calendar feed failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      console.error("Calendar feed error", e);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** This week's economic calendar. Served from a shared saved copy and refreshed every 15 minutes. */
export const getMarketCalendar = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && Date.now() - cache.at < FRESH_MS) return { ok: true as const, events: cache.events, updatedAt: cache.at };
  const saved = await readSaved();
  if (saved && Date.now() - saved.at < FRESH_MS) {
    cache = saved;
    return { ok: true as const, events: saved.events, updatedAt: saved.at };
  }
  const events = await fetchFeed();
  if (events) {
    cache = { at: Date.now(), events };
    await writeSaved(cache);
    return { ok: true as const, events, updatedAt: cache.at };
  }
  const fallback = cache ?? saved;
  if (fallback) return { ok: true as const, events: fallback.events, updatedAt: fallback.at };
  return { ok: false as const, error: "The news calendar is busy right now. Try again in a few minutes.", events: [] as MarketEvent[], updatedAt: 0 };
});
