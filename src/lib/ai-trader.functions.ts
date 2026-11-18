import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { readTradingView, tvName } from './tradingview.functions';
import { marketSession, type MarketSession } from './market-session';
import { runAiTrader } from './ai-trader.server';
import { reanchorTrade } from './ai-trader-policy';
import { resolveTradeStyle } from './auto-style';
import type { TradeStyle } from './trade-style';

export type AiTradeSignal = {
  ok: boolean; error?: string;
  side: 'BUY' | 'SELL' | 'WAIT'; confidence: number;
  entry: number; stopLoss: number; takeProfit: number;
  reason: string; strategy?: string; session?: MarketSession;
  trendSide?: 'BUY' | 'SELL'; turnConfirmed?: boolean;
  /** Style used for this trade's stop/target sizing; styleAuto marks a market-picked style. */
  style?: TradeStyle; styleReason?: string; styleAuto?: boolean;
  /** Levels the policy had to fit (stop/target sizing, compact target…). */
  adjusted?: string[];
};

const wait = (reason: string, session?: MarketSession): AiTradeSignal => ({ ok: true, side: 'WAIT', confidence: 0, entry: 0, stopLoss: 0, takeProfit: 0, reason, session });

/**
 * AI Trader scan: reads live TradingView data, picks the trade style (when set to Auto), lets the AI
 * make the BUY/SELL call, then re-reads the chart so the order is placed at the live price.
 * Only a closed market or missing chart data stops a trade — the AI itself never answers WAIT.
 */
export const getAiTrade = createServerFn({ method: 'POST' })
  .inputValidator((i: unknown) => z.object({ symbol: z.string().min(2).max(32), style: z.enum(['scalp', 'normal', 'swing', 'auto']) }).parse(i))
  .handler(async ({ data }): Promise<AiTradeSignal> => {
    const session = marketSession(data.symbol);
    if (session.quality === 'closed') return wait(session.reason, session);
    const tv = await readTradingView(data.symbol);
    if (!tv.ok) return { ...wait(''), ok: false, error: tv.error ?? `No TradingView chart for ${tvName(data.symbol)}` };
    const picked = resolveTradeStyle(data.style, tv, session);
    const ai = await runAiTrader(tv, picked.style, session, picked.auto ? picked.reason : undefined);
    if (!ai.ok) return { ...wait(''), ok: false, error: ai.error };
    if (!ai.check.ok) return { ...wait(''), ok: false, error: ai.check.reason };
    // Recheck live data before allowing execution; the trade moves with the live price.
    const fresh = await readTradingView(data.symbol);
    const freshSession = marketSession(data.symbol);
    if (freshSession.quality === 'closed') return wait(freshSession.reason, freshSession);
    if (!fresh.ok || fresh.ticker !== tv.ticker) return { ...wait(''), ok: false, error: 'Live chart could not be rechecked' };
    const trade = reanchorTrade(ai.check, fresh.price);
    return { ok: true, side: trade.side, confidence: trade.confidence, entry: trade.entry, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
      reason: trade.reason, strategy: ai.strategy, session: freshSession, trendSide: ai.trendSide, turnConfirmed: ai.turnConfirmed,
      style: picked.style, styleReason: picked.reason, styleAuto: picked.auto, adjusted: trade.adjusted };
  });
