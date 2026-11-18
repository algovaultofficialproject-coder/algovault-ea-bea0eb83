import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(["BUY", "SELL"]),
  stopLoss: z.number().nullable().optional(),
  takeProfit: z.number().nullable().optional(),
});

const Verdict = z.object({
  confirm: z.boolean(),
  confidence: z.number().min(0).max(100),
  structure: z.string().max(120),
  reason: z.string().max(240),
});

function yahooTicker(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(M|PRO|ECN|RAW|C|I)$/,"");
  const map: Record<string, string> = {
    XAUUSD: "GC=F", GOLD: "GC=F", XAGUSD: "SI=F", SILVER: "SI=F", USOIL: "CL=F", WTI: "CL=F", UKOIL: "BZ=F",
    BTCUSD: "BTC-USD", ETHUSD: "ETH-USD", US30: "^DJI", DJ30: "^DJI", NAS100: "^NDX", USTEC: "^NDX",
    SPX500: "^GSPC", US500: "^GSPC", GER40: "^GDAXI", UK100: "^FTSE", JP225: "^N225",
  };
  for (const k of Object.keys(map)) if (s.startsWith(k)) return map[k];
  const fx = s.slice(0, 6);
  return /^[A-Z]{6}$/.test(fx) ? `${fx}=X` : null;
}

type Candle = [number, number, number, number, number];

async function candles(ticker: string, interval: string, range: string): Promise<Candle[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) return [];
  const j = (await r.json()) as any;
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  const ts: number[] = res?.timestamp ?? [];
  const out: Candle[] = [];
  ts.forEach((t, i) => {
    const o = q?.open?.[i], h = q?.high?.[i], l = q?.low?.[i], c = q?.close?.[i];
    if ([o, h, l, c].every((v) => typeof v === "number")) out.push([t, +o.toPrecision(7), +h.toPrecision(7), +l.toPrecision(7), +c.toPrecision(7)]);
  });
  return out;
}

/** Confirms an incoming signal against live price action before execution. */
export const confirmSignal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { confirm: false, confidence: 0, structure: "", reason: "AI scanner not configured" };
    const ticker = yahooTicker(data.symbol);
    if (!ticker) return { confirm: false, confidence: 0, structure: "", reason: `no price feed for ${data.symbol}` };
    const [m5, m15, h1] = await Promise.all([
      candles(ticker, "5m", "1d").catch(() => []),
      candles(ticker, "15m", "5d").catch(() => []),
      candles(ticker, "60m", "1mo").catch(() => []),
    ]);
    if (m5.length < 20 && m15.length < 20) {
      return { confirm: false, confidence: 0, structure: "", reason: "market data unavailable (market closed?)" };
    }
    const model = createLovableAiGatewayProvider(key)("google/gemini-3-flash-preview");
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: Verdict }),
        messages: [
          {
            role: "system",
            content:
              "You are an elite institutional price-action trader. Confirm or reject a proposed trade using ONLY the OHLC candles given ([unixTime, open, high, low, close]). " +
              "Work top-down: H1 trend & market structure (HH/HL vs LH/LL, BOS/CHoCH), M15 key support/resistance, supply/demand zones and liquidity sweeps, " +
              "then M5 entry trigger (engulfing, pin bar rejection, inside-bar break, break-and-retest). Check that price is not entering straight into an opposing level, " +
              "that momentum agrees, and that any SL/TP gives reward:risk >= 1. Confirm only when the confluence clearly supports the proposed direction; reject counter-trend trades into strong levels. " +
              "confidence is 0-100. structure is a short label like 'H1 uptrend, M5 bullish engulf at demand'.",
          },
          {
            role: "user",
            content: JSON.stringify({
              symbol: data.symbol, side: data.side, stopLoss: data.stopLoss ?? null, takeProfit: data.takeProfit ?? null,
              H1: h1.slice(-60), M15: m15.slice(-80), M5: m5.slice(-80),
            }),
          },
        ],
      });
      return { ...output, confirm: output.confirm && output.confidence >= 60 };
    } catch (e) {
      return { confirm: false, confidence: 0, structure: "", reason: e instanceof Error ? e.message.slice(0, 200) : "scan failed" };
    }
  });
