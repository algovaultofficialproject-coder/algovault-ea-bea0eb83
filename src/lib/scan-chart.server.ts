import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { SCAN_STRATEGIES, notChartReply, scanStrategy, tfLabel } from "./chart-scan-view";

export const SCAN_MODEL = "openai/gpt-5.4-mini";

export type Verdict = "BUY" | "SELL";

export type Signal = {
  /** True when the upload is not a trading chart: side is WAIT and nothing may be executed. */
  noChart?: boolean;
  symbol: string;
  timeframe: string;
  timeframeSource: "chart" | "estimated";
  strategy: string;
  side: Verdict | "WAIT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  confidence: "low" | "medium" | "high";
  confidencePct: number;
  rationale: string;
  /* Ultra analyzer extras */
  trend: string;
  htfBias: string;
  structure: string;
  volatility: string;
  session: string;
  riskReward: number;
  keyLevels: number[];
  patterns: string[];
  confluences: string[];
  warnings: string[];
  invalidation: string;
  grade: string;
  quality: number;
  model: string;
};

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const strList = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [])
    .map((x) => String(x).slice(0, 90))
    .filter(Boolean)
    .slice(0, max);

const grades = ["A+", "A", "B", "C", "D"];

function noChartSignal(reason: string, model: string): Signal {
  return {
    noChart: true, symbol: "", timeframe: "—", timeframeSource: "estimated", strategy: "", side: "WAIT",
    entry: 0, stopLoss: 0, takeProfit: 0, takeProfit2: 0, confidence: "low", confidencePct: 0,
    rationale: `No trading chart detected in this picture${reason ? ` (${reason.slice(0, 120)})` : ""}. Upload a screenshot of a price chart to get a trade.`,
    trend: "", htfBias: "", structure: "", volatility: "", session: "", riskReward: 0, keyLevels: [], patterns: [],
    confluences: [], warnings: [], invalidation: "", grade: "D", quality: 0, model,
  };
}

function coerce(raw: string, fallbackSymbol: string | undefined, model: string): Signal {
  const match = raw.match(/\{[\s\S]*\}/);
  let obj: Record<string, unknown> = {};
  if (match) {
    try {
      obj = JSON.parse(match[0]);
    } catch {
      /* ignore */
    }
  }
  if (notChartReply(obj)) return noChartSignal(String(obj.reason ?? ""), model);
  const sideRaw = String(obj.side ?? "").toUpperCase();
  // Scanner is decisive: never WAIT. If the model hedges, infer direction from
  // the TP vs entry geometry, then from any bias text it produced.
  let side: Verdict;
  if (sideRaw === "SELL") side = "SELL";
  else if (sideRaw === "BUY") side = "BUY";
  else {
    const e = num(obj.entry);
    const tp = num(obj.takeProfit ?? obj.take_profit);
    if (e && tp) side = tp < e ? "SELL" : "BUY";
    else {
      const bias = `${obj.htfBias ?? ""} ${obj.htf_bias ?? ""} ${obj.trend ?? ""}`.toLowerCase();
      side = /bear|down|short|sell/.test(bias) ? "SELL" : "BUY";
    }
  }
  const confRaw = String(obj.confidence ?? "medium").toLowerCase();
  const confidence: Signal["confidence"] =
    confRaw === "high" ? "high" : confRaw === "low" ? "low" : "medium";
  const pct = num(obj.confidencePct);
  const entry = num(obj.entry);
  const stopLoss = num(obj.stopLoss ?? obj.stop_loss);
  const takeProfit = num(obj.takeProfit ?? obj.take_profit);
  let rr = num(obj.riskReward ?? obj.risk_reward);
  if (!rr && entry && stopLoss && takeProfit) {
    const risk = Math.abs(entry - stopLoss);
    if (risk > 0) rr = Math.abs(takeProfit - entry) / risk;
  }
  const gradeRaw = String(obj.grade ?? "").toUpperCase().trim();

  return {
    // Keep the symbol exactly as read from the chart / requested (case preserved
    // so broker suffixes like XAUUSD.m survive).
    symbol: String(obj.symbol ?? fallbackSymbol ?? "XAUUSD").trim(),

    timeframe: tfLabel(String(obj.timeframe ?? "")),
    timeframeSource: String(obj.timeframeSource ?? obj.timeframe_source ?? "").toLowerCase() === "chart" ? "chart" : "estimated",
    strategy: String(obj.strategy ?? "").slice(0, 60),
    side,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2: num(obj.takeProfit2 ?? obj.take_profit2),
    confidence,
    confidencePct: Math.max(
      0,
      Math.min(100, pct || (confidence === "high" ? 80 : confidence === "low" ? 30 : 55)),
    ),
    rationale: String(obj.rationale ?? raw.slice(0, 240)).slice(0, 500),
    trend: String(obj.trend ?? "unclear").slice(0, 60),
    htfBias: String(obj.htfBias ?? obj.htf_bias ?? "").slice(0, 60),
    structure: String(obj.structure ?? "").slice(0, 200),
    volatility: String(obj.volatility ?? "").slice(0, 40),
    session: String(obj.session ?? "").slice(0, 40),
    riskReward: Math.round(rr * 100) / 100,
    keyLevels: (Array.isArray(obj.keyLevels) ? obj.keyLevels : []).map(num).filter(Boolean).slice(0, 6),
    patterns: strList(obj.patterns, 6),
    confluences: strList(obj.confluences, 6),
    warnings: strList(obj.warnings, 4),
    invalidation: String(obj.invalidation ?? "").slice(0, 160),
    grade: grades.includes(gradeRaw) ? gradeRaw : "B",
    quality: Math.max(0, Math.min(10, num(obj.quality) || Math.round((pct || 55) / 10))),
    model,
  };
}

const analystSystem = (strategyId: string, symbol?: string) => {
  const st = scanStrategy(strategyId);
  const book = SCAN_STRATEGIES.filter((x) => x.id !== "auto").map((x) => `${x.label}: ${x.focus}`).join(" | ");
  return (
    "You are the AlgoVault smart chart scanner. You analyse the uploaded chart yourself with the same method AutoTrader Pro uses on live candles. " +
    "STEP 0 — CHART CHECK: first decide whether the image is a price chart of a tradable market (candlesticks, bars or a price line with a price axis). " +
    "If it is NOT (a photo, selfie, logo, document, chat or any screen without a price chart), do no analysis and reply ONLY {\"isChart\":false,\"reason\":\"<what the picture shows>\"}. " +
    "The BUY/SELL rules below apply only to real charts. " +
    "Deconstruct the chart in strict order: " +
    "(1) TIMEFRAME AUTO-DETECT: read the timeframe printed on the chart UI (toolbar button, legend next to the symbol such as 'XAUUSD, 15' or 'M15', or the interval selector). " +
    "Write it as M1/M5/M15/M30/H1/H4/D1/W1 and set timeframeSource to \"chart\". Only when nothing is printed, estimate it from the time-axis labels and candle spacing and set timeframeSource to \"estimated\". Never default to H1. " +
    "(2) symbol and current price read directly off the chart and price axis; " +
    "(3) closed candles only — ignore the still-forming last candle; " +
    "(4) top-down bias: swing structure of the visible history (HH/HL bullish, LH/LL bearish) before the latest leg; " +
    "(5) structure events — BOS, CHoCH, equal highs/lows, range vs trend; " +
    "(6) liquidity pools, sweeps, inducement; premium/discount of the current dealing range; order blocks, breakers, FVGs; " +
    "(7) volatility (average candle range = your ATR) and momentum/candle quality; " +
    "(8) the confluence stack for and against, and what invalidates it. " +
    `Strategy book: ${book}. ` +
    (st.id === "auto"
      ? "Strategy: AUTO — test each strategy in the book and trade the one with the strongest confluence; put its name in strategy. "
      : `Strategy: ${st.label} — trade ONLY with these rules: ${st.focus} Put "${st.label}" plus the exact trigger in strategy. `) +
    (symbol ? `Symbol is ${symbol}. ` : "Read the symbol from the chart UI. ") +
    "AutoTrader Pro risk model: stopLoss beyond the invalidation swing / order block plus a buffer of about 0.3x the average candle range; " +
    "takeProfit placed just before the nearest opposing liquidity or structure (never out to it), takeProfit2 at the next pool. " +
    "Never invent price levels — every number must come from the visible price axis. Be brutally honest about weak setups."
  );
};

const verdictSystem = (strategyId: string) =>
  "You are the ULTRA Gemini Scanner's execution head. Convert the analysis into ONE executable, tradable verdict. " +
  "You must ALWAYS commit to a direction: side is either BUY or SELL. WAIT, NEUTRAL, NO-TRADE and hedging are forbidden. " +
  "Decide the side with this fixed, objective checklist (the chosen strategy decides the entry, not the side): " +
  "(a) higher-timeframe swing structure (higher highs/lows = BUY bias, lower highs/lows = SELL bias); " +
  "(b) the position of price inside the visible range (discount favours BUY, premium favours SELL); " +
  "(c) the nearest untapped liquidity pool price is being drawn toward; " +
  "(d) the last confirmed BOS/CHoCH direction. " +
  "Score these four: the side winning the majority is the verdict; on a 2-2 tie, follow (a) the higher-timeframe structure. " +
  "The same chart must always yield the same side — be deterministic and repeatable, never random. " +
  "Self-critique first: does the entry chase price? is the stop structural (beyond the invalidation swing/OB) rather than arbitrary? " +
  "is the target parked in front of real liquidity? " +
  "PROFITABILITY RULES (mandatory, they exist because chasing loses money): " +
  "1. NEVER enter at market in the middle of a range or after an extended impulse — the entry must be a pullback into a named level " +
  "(order block, breaker, FVG/imbalance, prior swing retest, trendline or moving-average retest, or the level a liquidity sweep just created). " +
  "2. Trade WITH the higher-timeframe bias; counter-trend setups are only allowed after a confirmed CHoCH plus a liquidity sweep. " +
  "3. The stop must sit beyond the invalidation swing (add a small buffer for wicks/spread), never inside the noise. " +
  "4. takeProfit must be placed just BEFORE the next opposing liquidity pool / structural level so it actually gets hit; " +
  "takeProfit2 may extend to the deeper pool. " +
  `5. Reject geometry that cannot reach R:R ${scanStrategy(strategyId).minRR} — reprice the entry deeper into the level until the R:R works. ` +
  "6. Avoid setups sitting into obvious high-impact news or the illiquid rollover hour: keep the direction but lower confidence and warn. " +
  "7. Require at least 3 independent confluences; with fewer, keep the side but grade C/D and cut confidence so the user can size small. " +
  "If the immediate setup looks weak or mid-range, do NOT refuse — pick the side with the strongest higher-timeframe bias and " +
  "liquidity draw, and park the entry at the nearest high-probability level instead of at market. " +
  "Every signal must have a real entry, a structural stopLoss and takeProfit levels taken from the visible price axis — never zeros. " +
  "Lower the confidence, quality and grade for weaker setups instead of refusing them, and list the risks in warnings. " +
  "Grade the setup A+ (textbook, full confluence) down to D (low conviction but still directional). " +
  "Reply with ONLY one JSON object, no markdown fences: " +
  '{"isChart":true,"symbol":string,"timeframe":string,"timeframeSource":"chart"|"estimated","strategy":string,"side":"BUY"|"SELL","entry":number,"stopLoss":number,"takeProfit":number,"takeProfit2":number,' +
  '"confidence":"low"|"medium"|"high","confidencePct":number,"quality":number,"grade":"A+"|"A"|"B"|"C"|"D","trend":string,"htfBias":string,' +
  '"structure":string,"volatility":string,"session":string,"riskReward":number,"keyLevels":number[],"patterns":string[],' +
  '"confluences":string[],"warnings":string[],"invalidation":string,"rationale":string}. ' +
  "quality is 0-10.";

function friendlyError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  const status = Number((e as { statusCode?: number })?.statusCode ?? 0);
  const s = raw.toLowerCase();
  if (status === 402 || s.includes("payment required") || s.includes("not enough credits"))
    return new Error(
      "AI credits exhausted — the workspace has no Lovable AI credits left. Add credits (Settings → Plans & credits) to run the scanner again.",
    );
  if (status === 429 || s.includes("rate limit"))
    return new Error("AI scanner is rate limited. Wait a few seconds and scan again.");
  if (status === 403) return new Error("Lovable AI is disabled for this workspace.");
  return new Error(raw.slice(0, 300) || "AI scan failed");
}

/** Fixed seed + zero temperature => the same chart always scans the same way. */
const SEED = 20260731;
const USER_TASK =
  "Run the full ultra scan on this chart: analyse silently through every step, self-critique the setup, then output ONLY the JSON verdict object. Be deterministic: identical charts must always produce the identical verdict.";

const median = (xs: number[]) => {
  const v = xs.filter((n) => Number.isFinite(n) && n !== 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/**
 * Majority vote across independent passes. The winning side's numbers are
 * merged by median so one hallucinated level can't skew entry/SL/TP, and
 * confidence/quality are cut when the passes disagree.
 */
function consensus(signals: Signal[]): Signal {
  if (signals.length === 1) return signals[0];
  const buys = signals.filter((s) => s.side === "BUY");
  const sells = signals.filter((s) => s.side === "SELL");
  const winners = buys.length >= sells.length ? buys : sells;
  const agreement = winners.length / signals.length;
  const base = [...winners].sort((a, b) => b.confidencePct - a.confidencePct)[0];

  const entry = median(winners.map((s) => s.entry)) || base.entry;
  const stopLoss = median(winners.map((s) => s.stopLoss)) || base.stopLoss;
  const takeProfit = median(winners.map((s) => s.takeProfit)) || base.takeProfit;
  const risk = Math.abs(entry - stopLoss);
  const rr = risk > 0 ? Math.abs(takeProfit - entry) / risk : base.riskReward;

  const confidencePct = Math.round(
    (median(winners.map((s) => s.confidencePct)) || base.confidencePct) * agreement,
  );
  const warnings = [...base.warnings];
  if (agreement < 1)
    warnings.unshift(
      `Passes disagreed (${winners.length}/${signals.length} agreed on ${base.side}) — treat as lower conviction.`,
    );

  return {
    ...base,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2: median(winners.map((s) => s.takeProfit2)) || base.takeProfit2,
    riskReward: Math.round(rr * 100) / 100,
    confidencePct,
    confidence: confidencePct >= 70 ? "high" : confidencePct <= 40 ? "low" : "medium",
    quality: Math.max(0, Math.min(10, Math.round(base.quality * agreement))),
    grade: agreement === 1 ? base.grade : agreement >= 0.67 ? "C" : "D",
    warnings: warnings.slice(0, 5),
    model: `${base.model} x${signals.length} consensus`,
  };
}

const PASSES = 3;


export async function runUltraScan(opts: {
  apiKey?: string;
  freeKey?: string;
  imageDataUrl: string;
  strategy: string;
  symbol?: string;
}): Promise<Signal> {
  if (!opts.apiKey) throw new Error("Scanner not configured");

  const gateway = createLovableAiGatewayProvider(opts.apiKey);
  const model = gateway(SCAN_MODEL);

  const passes: Signal[] = [];
  let firstErr: unknown = null;

  for (let i = 0; i < PASSES; i++) {
    try {
      const verdict = await generateText({
        model,
        temperature: 0,
        topP: 0.1,
        seed: SEED,
        messages: [
          {
            role: "system",
            content: `${analystSystem(opts.strategy, opts.symbol)}\n\n${verdictSystem(opts.strategy)}`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: USER_TASK },
              { type: "image", image: opts.imageDataUrl },
            ],
          },
        ],
      });
      const pass = coerce(verdict.text ?? "", opts.symbol, SCAN_MODEL);
      if (pass.noChart) return pass;
      passes.push(pass);
    } catch (e) {
      if (!firstErr) firstErr = e;
      break;
    }
  }

  if (!passes.length) throw friendlyError(firstErr);
  return consensus(passes);
}
