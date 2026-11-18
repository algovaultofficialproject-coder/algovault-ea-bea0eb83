import { generateChatCompletion } from '@lovable.dev/ai-gateway';
import { z } from "zod";
import type { MarketSession } from './market-session';
import { ultraSignal } from "./tv-strategy";
import { validateSwingSignal, type SwingRead, type ScanTimeframe } from './smart-signal-policy';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import { scanStrategies } from './strategy-scan';
import { isExtremeVolatility, volatilityStrategy } from './volatility-strategy';
import type { TradeStyle } from './trade-style';

const Verdict = z.object({
  side: z.enum(["BUY", "SELL", "WAIT"]),
  confidence: z.number(),
  entry: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  reason: z.string(),
  timeframe: z.enum(['5m', '15m', '1h', '4h']),
  timeframeReason: z.string(),
});

export type SmartSignal = {
  ok: boolean;
  side: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  price: number;
  ruleScore: number;
  ruleReasons: string[];
  error?: string;
  timeframe?: ScanTimeframe;
  timeframeReason?: string;
  rewardRisk?: number;
  ready?: boolean;
  executionNote?: string;
  session?: MarketSession;
  turnConfirmed?: boolean;
  trendSide?: 'BUY' | 'SELL';
  /** Autotrader: style that sized this signal and why (styleAuto = picked from the market). */
  style?: TradeStyle; styleReason?: string; styleAuto?: boolean;
};

/**
 * Smart AI scanner: combines the rule-based multi-timeframe confluence
 * strategy with an AI analyst that reviews the same TradingView readings
 * and returns one final BUY/SELL/WAIT call with entry, stop and target.
 */
export async function runSmartSignal(read: SwingRead, directional = false, session?: MarketSession, style: TradeStyle = 'normal'): Promise<SmartSignal> {
  const rule = ultraSignal(read);
  // Autotrader always uses the built-in engine, never a paid model or fallback.
  if (directional) {
    const output = analyzeBuiltinAuto(read, session, style);
    const ready = output.side !== 'WAIT' && session?.quality !== 'closed';
    return { ok: true, ...output, price: read.price, ruleScore: rule?.score ?? 0, ruleReasons: rule?.reasons ?? [], session, ready,
      executionNote: ready ? undefined : output.side === 'WAIT' ? output.reason : `${session?.reason ?? 'Market closed'} — signal shown, not executed`,
      rewardRisk: ready ? Math.abs(output.takeProfit - output.entry) / Math.abs(output.entry - output.stopLoss) : undefined };
  }

  const base: Omit<SmartSignal, "side" | "confidence" | "entry" | "stopLoss" | "takeProfit" | "reason"> = {
    ok: true,
    price: read.price,
    ruleScore: rule?.score ?? 0,
    ruleReasons: rule?.reasons ?? [],
    session,
  };

  // Second opinions the AI weighs: the built-in engine's call and every observed strategy.
  const engine = analyzeBuiltinAuto(read, session, style);
  const scan = scanStrategies(read);
  const volatility = volatilityStrategy(read, { m15: 0, m5: 0, m1: 0 }).regime;
  const evidence = {
    builtInEngine: { side: engine.side, confidence: engine.confidence, reason: engine.reason.slice(0, 400) },
    volatilityRegime: isExtremeVolatility(read) ? 'extreme' : volatility,
    strategies: scan.hits.map(h => ({ side: h.dir > 0 ? 'BUY' : 'SELL', weight: h.weight, kind: h.name, what: h.label })).slice(0, 24),
    nearestSupports: scan.supports.slice(0, 3), nearestResistances: scan.resistances.slice(0, 3),
    marketConditions: { choppy: !!scan.choppy, squeeze: !!scan.squeeze, volumeRatio: scan.volumeRatio ?? null,
      spike: scan.spike ? { side: scan.spike.dir > 0 ? 'BUY' : 'SELL', kind: scan.spike.kind, sizeVsNormal: scan.spike.size, timeframe: scan.spike.timeframe } : null },
  };

  try {
    const response = await generateChatCompletion({
      model: 'openai/gpt-6-astra',
      response_format: { type: 'json_schema', json_schema: { name: 'trading_signal', strict: true, schema: z.toJSONSchema(Verdict) } },
      messages: [
        {
          role: "system",
          content:
            "You are an elite multi-timeframe TradingView analyst. You receive live scanner readings: price, overall ratings for 5m/15m/1h/4h (-1 strong sell … +1 strong buy), " +
            "15m MA rating, RSI, ADX, EMA50(15m), EMA200(1h), MACD and its signal, plus a rule-engine score and its confluences. " +
            "Decide BUY, SELL or WAIT from the supplied evidence. Compare 5m, 15m, 1h and 4h; distinguish a fast pullback from a sustained trend using ratings, price/EMA distance in ATR, RSI, ADX and MACD. " +
            "Use the selected timeframe's RSI, ADX and EMA50 and explain the choice. Never promise profits. " +
            "Always size stop loss and take profit with the 15m ATR, whichever timeframe you select: 1h and 4h levels sit too far away. " +
            "Give entry within 0.35 15m ATR of price. Use normal levels, never widened: stop loss 1 to 2 15m ATR away, take profit 1 to 2.5 15m ATR away (aim for reward:risk around 1 to 1.5). " +
            "Evaluate BUY and SELL with equal weight and no directional bias: return BUY whenever the evidence shows upward movement (price above EMA, RSI above 50, positive ratings) and SELL only when it shows downward movement. Never default to SELL. If readings are missing or confluence is weak, answer WAIT. " +
            "reason: one short sentence naming the top confluences.",
        },
        { role: 'system', content: 'You also receive "evidence": the built-in engine\'s call, every observed strategy (trend, momentum, structure, key levels, candles, volume) with its direction and weight, the volatility regime, the nearest supports/resistances and market conditions. ' +
          'Think like a professional: 1) identify the regime (trend, range, transition) and volatility; 2) pick the strategy family that fits that regime; 3) count agreement across DIFFERENT kinds of evidence, not repeats of one kind; 4) check the path to the target is not blocked by a nearby level; 5) in extreme volatility prefer pullbacks/retests over chasing; in quiet markets prefer range edges. ' +
          'The engine and strategies are evidence, not orders: disagree with them when the readings justify it. Mention the deciding evidence in reason.' },
        { role: 'system', content: 'Manual scanner mode: require 1h and 4h directional agreement, selected rating >=0.1 in the trade direction, confidence >=70, ADX>=20 and RSI between 28 and 72. Price must confirm the selected EMA trend.' },
        ...(session ? [{ role: 'system' as const, content: `Current session context: ${JSON.stringify(session)}. Assess session suitability for this instrument before deciding. An open Sydney/Tokyo or low-liquidity window alone is NOT a reason to refuse a supported signal: weigh actual ATR, trend and momentum. Return WAIT when evidence is inadequate; never force a trade. Crypto can trade 24/7. Session windows are indicative, not verified broker hours or holiday calendars. reason must name concrete supplied price/EMA/RSI/ADX/ATR evidence or the exact condition needed before a trade; do not use vague claims like "market aligned".` }] : []),
        {
          role: "user",
          content: JSON.stringify({
            price: read.price,
            rating5m: read.rating5, rating15m: read.rating15, rating1h: read.rating60, rating4h: read.rating240,
            maRating15m: read.ma15, rsi15m: read.rsi15, adx15m: read.adx15,
            ema50_15m: read.ema50_15, ema200_1h: read.ema200_60,
            macd15m: read.macd15, macdSignal15m: read.macdSig15,
            timeframeReadings: { '5m': { atr: read.atr5, rsi: read.rsi5, adx: read.adx5, ema50: read.ema50_5 }, '15m': { atr: read.atr15, rsi: read.rsi15, adx: read.adx15, ema50: read.ema50_15 }, '1h': { atr: read.atr60, rsi: read.rsi60, adx: read.adx60, ema50: read.ema50_60 }, '4h': { atr: read.atr240, rsi: read.rsi240, adx: read.adx240, ema50: read.ema50_240 } },
            ruleEngine: rule ? { side: rule.side, score: rule.score, confluences: rule.reasons } : null,
            evidence,
          }),
        },
      ],
    });
    const content = response.choices[0]?.message.content;
    if (typeof content !== 'string') throw new Error('AI returned no signal');
    const output = Verdict.parse(JSON.parse(content));
    output.confidence = Number.isFinite(output.confidence) ? Math.max(0, Math.min(100, output.confidence)) : 0;
    output.reason = output.reason.slice(0, 280);
    output.timeframeReason = output.timeframeReason.slice(0, 200);
    const rejected = validateSwingSignal(read, output);
    if (rejected || output.side === 'WAIT') return { ...base, side: 'WAIT', confidence: output.confidence, entry: read.price, stopLoss: 0, takeProfit: 0, reason: rejected ?? output.reason, timeframe: output.timeframe, timeframeReason: output.timeframeReason };
    const { entry, stopLoss: sl, takeProfit: tp } = output;
    return { ...base, side: output.side, confidence: output.confidence, entry, stopLoss: sl, takeProfit: tp, reason: output.reason, timeframe: output.timeframe, timeframeReason: output.timeframeReason, rewardRisk: Math.abs(tp - entry) / Math.abs(entry - sl) };
  } catch (e) {
    // No synthetic bigger-move signal when the AI is unavailable.
    return { ...base, ok: false, side: "WAIT", confidence: 0, entry: read.price, stopLoss: 0, takeProfit: 0, reason: "", error: e instanceof Error ? e.message.slice(0, 200) : "AI scan failed" };
  }
}
