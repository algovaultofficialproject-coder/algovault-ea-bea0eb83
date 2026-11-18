import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readTradingView, tvName } from "./tradingview.functions";
import { runSmartSignal, type SmartSignal } from "./smart-signal.server";
import { marketSession } from './market-session';
import { resolveTradeStyle } from './auto-style';

/**
 * One-call smart scanner: fetches live TradingView readings for the symbol,
 * then runs built-in autotrader analysis (or the manual AI analyst) for a BUY/SELL/WAIT decision
 * with entry, stop loss and take profit.
 */
export const getSmartSignal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ symbol: z.string().min(2).max(32), directional: z.boolean().optional(), style: z.enum(['scalp', 'normal', 'swing', 'auto']).optional(), recheck: z.boolean().optional() }).parse(i))
  .handler(async ({ data }): Promise<SmartSignal> => {
    const session = marketSession(data.symbol);
    const tv = await readTradingView(data.symbol);
    if (!tv.ok) {
      return { ok: false, side: "WAIT", confidence: 0, entry: 0, stopLoss: 0, takeProfit: 0, reason: "", price: 0, ruleScore: 0, ruleReasons: [], error: tv.error ?? `No TradingView chart for ${tvName(data.symbol)}` };
    }
    // Auto style: the market picks scalp / normal / swing once per scan; the recheck keeps that style.
    const picked = resolveTradeStyle(data.style ?? 'normal', tv, session);
    const styled = { style: picked.style, styleReason: picked.reason, styleAuto: picked.auto };
    const result = { ...(await runSmartSignal(tv, data.directional, session, picked.style)), ...styled };
    // Sampling reads inside the careful 15 s window skip the recheck; the deciding read always rechecks.
    if (!data.directional || data.recheck === false || !result.ready || !result.timeframe) return result;
    // Recheck live data and session before allowing execution; the direction is always shown.
    const fresh = await readTradingView(data.symbol);
    const freshSession = marketSession(data.symbol);
    const note = freshSession.quality === 'closed' ? `${freshSession.reason} — signal shown, not executed` : !fresh.ok ? 'Live movement could not be rechecked — not executed' : fresh.ticker !== tv.ticker ? 'Chart source changed — not executed' : null;
    if (note || !fresh.ok) return { ...result, ready: false, executionNote: note ?? undefined, session: freshSession };
    const again = { ...(await runSmartSignal(fresh, true, freshSession, picked.style)), ...styled };
    return again.side === result.side ? again : { ...again, ready: false, executionNote: 'Direction flipped during recheck — updating on next scan' };
  });
