/**
 * Uses gemini-flash-lite-latest: gemini-flash-latest did not answer within 25 s in testing, too slow for a 15 s scan.
 * Gemini market referee (server-only). Keys live in public.gemini_keys (owner-managed on /bridge-keys);
 * key 1 is tried first and key 2 is the fallback. Verdicts are cached per symbol per closed 15m candle in
 * public.gemini_verdicts so every phone gets the same read and Gemini is called at most once per bar.
 */
import { loadCandles } from "./market-data.server";
import { parseGeminiVerdict, type GeminiVerdict } from "./autotrader-pro/gemini-referee";
import type { Candle } from "./autotrader-pro/types";

const MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent";
const BAR_MS = 15 * 60_000;
let keyCache: { at: number; keys: string[] } | null = null;

export function invalidateGeminiKeys() { keyCache = null; }

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function geminiKeys(): Promise<string[]> {
  if (keyCache && Date.now() - keyCache.at < 60_000) return keyCache.keys;
  const { data } = await (await admin()).from("gemini_keys").select("slot, api_key").order("slot");
  const keys = (data ?? []).map((r) => String(r.api_key).trim()).filter(Boolean);
  keyCache = { at: Date.now(), keys };
  return keys;
}

async function callGemini(prompt: string): Promise<string | null> {
  for (const key of await geminiKeys()) {
    try {
      const res = await fetch(MODEL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) { console.error(`Gemini key failed: ${res.status}`); continue; }
      const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (text) return text;
    } catch (e) { console.error("Gemini request error", e instanceof Error ? e.message : e); }
  }
  return null;
}

const rows = (cs: Candle[], digits: number) =>
  cs.map((c) => `${new Date(c.t).toISOString().slice(5, 16)} ${c.o.toFixed(digits)} ${c.h.toFixed(digits)} ${c.l.toFixed(digits)} ${c.c.toFixed(digits)}`).join("\n");

/** Closed candles only (the forming bar is dropped). */
const closed = (cs: Candle[], ms: number, now: number) => cs.filter((c) => c.t + ms <= now);

export async function geminiVerdict(symbol: string, now = Date.now()): Promise<GeminiVerdict | null> {
  const sym = symbol.toUpperCase();
  const [m15, h1] = await Promise.all([loadCandles(sym, "15m", 300), loadCandles(sym, "1h", 300)]);
  if (!m15.ok) return null;
  const c15 = closed(m15.candles, BAR_MS, now).slice(-60);
  if (c15.length < 20) return null;
  const barTime = c15[c15.length - 1].t;
  const db = await admin();
  const { data: hit } = await db.from("gemini_verdicts").select("side, confidence, reason").eq("symbol", sym).eq("bar_time", barTime).maybeSingle();
  if (hit) return { side: hit.side as GeminiVerdict["side"], confidence: hit.confidence, reason: hit.reason };

  const digits = /JPY/.test(sym) ? 3 : /XAU|GOLD|XAG|US30|NAS|SPX|GER|UK|BTC|ETH/.test(sym) ? 2 : 5;
  const c1h = h1.ok ? closed(h1.candles, 4 * BAR_MS, now).slice(-30) : [];
  const atr = c15.slice(-14).reduce((t, c, k, a) => t + Math.max(c.h - c.l, k ? Math.abs(c.h - a[k - 1].c) : 0, k ? Math.abs(c.l - a[k - 1].c) : 0), 0) / 14;
  const box = c15.slice(-21, -1), boxHi = Math.max(...box.map((c) => c.h)), boxLo = Math.min(...box.map((c) => c.l));
  const f = (n: number) => n.toFixed(digits);
  const prompt = `You are a disciplined professional ${sym} trader. Analyse these CLOSED candles step by step, then decide the NEXT trade.
Step 1 — Market state. Classify it as exactly one of: TREND UP, TREND DOWN, WIDE RANGE, SHORT/TIGHT RANGE, RANGE BREAKOUT, BREAKOUT RETEST, EXHAUSTION/REVERSAL, CHOP.
Step 2 — Apply the playbook for that state:
- TREND: trade only with it, after a pullback that holds (higher low / lower high). Never chase a candle already far (>2 ATR) from the 21-EMA area.
- WIDE or SHORT RANGE: buy a rejection of the floor, sell a rejection of the ceiling; never buy at the ceiling or sell at the floor.
- RANGE BREAKOUT: a strong, wide candle closing near its extreme outside the range = trade the break. A weak close or a wick back inside = false breakout, trade back into the range.
- BREAKOUT RETEST: price returns to the broken edge and holds = join the new direction.
- EXHAUSTION: a long stretched run that prints a climax candle and then closes through the last swing = the turn.
- CHOP (overlapping candles, no clear edges): WAIT.
Step 3 — Check liquidity: a sweep of a recent high/low that closes back inside points the other way. Use 1h only as context; 15m leads. Do not let the 1h trend veto a clean 15m range or breakout signal.
Give BUY or SELL whenever the playbook gives a clear edge; WAIT only for chop or when price sits mid-range with no edge. Confidence 0-100 reflects how clean the setup is.
Facts: 15m ATR(14) ≈ ${f(atr)}; previous 20-candle range ${f(boxLo)}–${f(boxHi)}; last close ${f(c15[c15.length - 1].c)}.
Reply ONLY with JSON: {"side":"BUY"|"SELL"|"WAIT","confidence":0-100,"reason":"<MARKET STATE>: one short sentence"}

15m candles (oldest first):
${rows(c15, digits)}

1h candles (oldest first):
${c1h.length ? rows(c1h, digits) : "unavailable"}`;
  const verdict = parseGeminiVerdict(await callGemini(prompt));
  if (!verdict) return null;
  await db.from("gemini_verdicts").upsert({ symbol: sym, bar_time: barTime, ...verdict }, { onConflict: "symbol,bar_time", ignoreDuplicates: true });
  // Read back so phones that raced this bar all use the first stored verdict.
  const { data: stored } = await db.from("gemini_verdicts").select("side, confidence, reason").eq("symbol", sym).eq("bar_time", barTime).maybeSingle();
  return stored ? { side: stored.side as GeminiVerdict["side"], confidence: stored.confidence, reason: stored.reason } : verdict;
}
