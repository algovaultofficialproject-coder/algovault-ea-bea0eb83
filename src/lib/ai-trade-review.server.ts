import { generateResponse } from '@lovable.dev/ai-gateway';
import { z } from 'zod';
import type { MarketSession } from './market-session';
import type { SwingRead } from './smart-signal-policy';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import { scanStrategies } from './strategy-scan';
import { isExtremeVolatility, volatilityStrategy } from './volatility-strategy';
import type { TradeStyle } from './trade-style';
import { interpretReview, type ReviewOutcome } from './ai-trade-review';

export const REVIEW_MODEL = 'openai/gpt-6-astra';

const Verdict = z.object({ approve: z.boolean(), confidence: z.number(), reason: z.string() });

export type ProposedTrade = { symbol: string; side: 'BUY' | 'SELL'; entry: number; stopLoss: number; takeProfit: number; style: TradeStyle };

/** Asks the AI risk manager to approve or block one proposed trade from fresh live readings. */
export async function reviewTradeWithAi(read: SwingRead, trade: ProposedTrade, session?: MarketSession): Promise<ReviewOutcome> {
  const engine = analyzeBuiltinAuto(read, session, trade.style);
  const scan = scanStrategies(read);
  const evidence = {
    proposedTrade: { ...trade, rewardRisk: +(Math.abs(trade.takeProfit - trade.entry) / Math.abs(trade.entry - trade.stopLoss)).toFixed(2) },
    livePrice: read.price,
    builtInEngineNow: { side: engine.side, confidence: engine.confidence, reason: engine.reason.slice(0, 400) },
    volatilityRegime: isExtremeVolatility(read) ? 'extreme' : volatilityStrategy(read, { m15: 0, m5: 0, m1: 0 }).regime,
    ratings: { '1m': read.rating1, '5m': read.rating5, '15m': read.rating15, '1h': read.rating60 },
    timeframeReadings: {
      '1m': { atr: read.atr1, rsi: read.rsi1, ema20: read.ema20_1, ema50: read.ema50_1 },
      '5m': { atr: read.atr5, rsi: read.rsi5, adx: read.adx5, ema50: read.ema50_5 },
      '15m': { atr: read.atr15, rsi: read.rsi15, adx: read.adx15, ema50: read.ema50_15, macd: read.macd15, macdSignal: read.macdSig15 },
      '1h': { atr: read.atr60, rsi: read.rsi60, adx: read.adx60, ema50: read.ema50_60, ema200: read.ema200_60 },
    },
    strategies: scan.hits.map(h => ({ side: h.dir > 0 ? 'BUY' : 'SELL', weight: h.weight, kind: h.name, what: h.label })).slice(0, 24),
    nearestSupports: scan.supports.slice(0, 3), nearestResistances: scan.resistances.slice(0, 3),
    marketConditions: { choppy: !!scan.choppy, squeeze: !!scan.squeeze, volumeRatio: scan.volumeRatio ?? null,
      spike: scan.spike ? { side: scan.spike.dir > 0 ? 'BUY' : 'SELL', kind: scan.spike.kind, sizeVsNormal: scan.spike.size, timeframe: scan.spike.timeframe } : null },
    session: session ?? null,
  };
  try {
    const response = await generateResponse({
      model: REVIEW_MODEL,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'trade_review', strict: true, schema: z.toJSONSchema(Verdict) } },
      instructions:
        'You are the risk manager for an automated trading robot. The robot has already found a trade; you only APPROVE or BLOCK it. You can never change its side or levels. ' +
        'Think like a professional: identify the regime (trend, range, transition) and volatility; check the trade agrees with the dominant higher-timeframe flow or a clearly confirmed reversal; ' +
        'count agreement across DIFFERENT kinds of evidence (trend, momentum, structure, levels, candles, volume), not repeats of one kind; check the path to the take profit is not blocked by a nearby support/resistance; ' +
        'block chasing a stretched spike in extreme volatility, trading the middle of a choppy range, or a trade the live built-in engine no longer supports. ' +
        'Approve sound setups: do not block just because the market could reverse, and treat BUY and SELL with equal weight. ' +
        'confidence: 0-100 for your decision. reason: one short sentence naming the deciding evidence with concrete numbers.',
      input: [{ role: 'user', content: JSON.stringify(evidence) }],
    });
    const text = response.output
      .flatMap((item) => (item.type === 'message' ? item.content : []))
      .map((part) => (part.type === 'output_text' ? part.text : ''))
      .join('');
    if (!text) return interpretReview(null, 'AI returned no answer');
    return interpretReview(Verdict.parse(JSON.parse(text)));
  } catch (e) {
    return interpretReview(null, e instanceof Error ? e.message : 'AI check failed');
  }
}
