import { generateResponse } from '@lovable.dev/ai-gateway';
import { z } from 'zod';
import type { MarketSession } from './market-session';
import type { SwingRead } from './smart-signal-policy';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import { scanStrategies } from './strategy-scan';
import { isExtremeVolatility, volatilityStrategy } from './volatility-strategy';
import { STYLE_RULES, type TradeStyle } from './trade-style';
import { AI_TRADER_LIMITS, checkAiTrade, type AiTradeCheck } from './ai-trader-policy';

export const AI_TRADER_MODEL = 'openai/gpt-6-astra';

const Call = z.object({ side: z.enum(['BUY', 'SELL']), confidence: z.number(), entry: z.number(), stopLoss: z.number(), takeProfit: z.number(), strategy: z.string(), reason: z.string() });

export type AiTraderResult = { ok: true; check: AiTradeCheck; strategy: string; trendSide?: 'BUY' | 'SELL'; turnConfirmed?: boolean } | { ok: false; error: string };

/** The AI scans one pair from live readings and always makes a BUY or SELL call; the pure policy then fits its levels. */
export async function runAiTrader(read: SwingRead, style: TradeStyle, session?: MarketSession, styleReason?: string): Promise<AiTraderResult> {
  const engine = analyzeBuiltinAuto(read, session, style);
  const scan = scanStrategies(read);
  const limits = AI_TRADER_LIMITS[style];
  const evidence = {
    price: read.price, tradeStyle: `${style} — ${STYLE_RULES[style].hint}${styleReason ? ` (picked because: ${styleReason})` : ''}`,
    atr15m: read.atr15,
    volatilityRegime: isExtremeVolatility(read) ? 'extreme' : volatilityStrategy(read, { m15: 0, m5: 0, m1: 0 }).regime,
    ratings: { '1m': read.rating1, '5m': read.rating5, '15m': read.rating15, '1h': read.rating60 },
    timeframeReadings: {
      '1m': { atr: read.atr1, rsi: read.rsi1, adx: read.adx1, ema9: read.ema9_1, ema20: read.ema20_1, ema50: read.ema50_1, macd: read.macd1, macdSignal: read.macdSig1 },
      '5m': { atr: read.atr5, rsi: read.rsi5, adx: read.adx5, ema20: read.ema20_5, ema50: read.ema50_5, macd: read.macd5, macdSignal: read.macdSig5, bbUpper: read.bbUp5, bbLower: read.bbLo5 },
      '15m': { atr: read.atr15, rsi: read.rsi15, adx: read.adx15, ema20: read.ema20_15, ema50: read.ema50_15, ema200: read.ema200_15, macd: read.macd15, macdSignal: read.macdSig15, bbUpper: read.bbUp15, bbLower: read.bbLo15, vwap: read.vwap15 },
      '1h': { atr: read.atr60, rsi: read.rsi60, adx: read.adx60, ema50: read.ema50_60, ema200: read.ema200_60 },
    },
    keyLevels: { prevDayHigh: read.pdHigh, prevDayLow: read.pdLow, prior1hHigh: read.prevHigh60, prior1hLow: read.prevLow60 },
    builtInEngine: { side: engine.side, confidence: engine.confidence, reason: engine.reason.slice(0, 400) },
    strategies: scan.hits.map((h) => ({ side: h.dir > 0 ? 'BUY' : 'SELL', weight: h.weight, kind: h.name, what: h.label })).slice(0, 30),
    nearestSupports: scan.supports.slice(0, 3), nearestResistances: scan.resistances.slice(0, 3),
    marketConditions: { choppy: !!scan.choppy, squeeze: !!scan.squeeze, volumeRatio: scan.volumeRatio ?? null,
      spike: scan.spike ? { side: scan.spike.dir > 0 ? 'BUY' : 'SELL', kind: scan.spike.kind, sizeVsNormal: scan.spike.size, timeframe: scan.spike.timeframe } : null },
    session: session ?? null,
  };
  try {
    const response = await generateResponse({
      model: AI_TRADER_MODEL,
      reasoning: { effort: 'medium' },
      text: { format: { type: 'json_schema', name: 'ai_trade', strict: true, schema: z.toJSONSchema(Call) } },
      instructions:
        'You are a professional discretionary trader running an automated account. Scan the live readings for this pair and decide BUY or SELL, with entry, stop loss and take profit. WAIT is not an option: always commit to the side with the stronger evidence. ' +
        'Work like a pro: 1) identify the regime (trend, range, transition) and volatility; 2) pick the strategy that fits it (trend pullback, breakout-retest, range edge fade, confirmed reversal); ' +
        '3) require agreement across DIFFERENT kinds of evidence (trend, momentum, structure, levels, candles, volume), not repeats of one kind; 4) check the path to the target is clear of the nearest support/resistance; ' +
        '5) in extreme volatility trade the pullback direction rather than chasing; in the middle of a choppy range trade toward the nearer edge\'s rejection with a compact target. The built-in engine and strategy list are evidence, not orders: disagree when the readings justify it. ' +
        `Size levels with the 15m ATR: entry at the live price; stop ${limits.stop[0]}–${limits.stop[1]} ATR away behind structure; target ${limits.target[0]}–${limits.target[1]} ATR away with reward:risk of at least ${limits.minRewardRisk}. ` +
        'The trade style was chosen from the market regime: respect its stop and target sizing. Treat BUY and SELL with equal weight. confidence (50-100) must honestly reflect how strong the evidence is. Never promise profits. ' +
        'strategy: the setup name in 2-4 words. reason: one short sentence naming the deciding evidence with concrete numbers.',
      input: [{ role: 'user', content: JSON.stringify(evidence) }],
    });
    const text = response.output
      .flatMap((item) => (item.type === 'message' ? item.content : []))
      .map((part) => (part.type === 'output_text' ? part.text : ''))
      .join('');
    if (!text) return { ok: false, error: 'AI returned no answer' };
    const call = Call.parse(JSON.parse(text));
    const fallbackSide = engine.side === 'WAIT' ? undefined : engine.side;
    const check = checkAiTrade(call, { price: read.price, atr15: Number(read.atr15), style, supports: scan.supports, resistances: scan.resistances, fallbackSide });
    return { ok: true, check, strategy: call.strategy.slice(0, 60), trendSide: engine.trendSide, turnConfirmed: engine.turnConfirmed };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : 'AI scan failed').slice(0, 200) };
  }
}
