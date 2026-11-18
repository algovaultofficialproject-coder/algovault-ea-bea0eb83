import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { readTradingView } from './tradingview.functions';
import { marketSession } from './market-session';
import { reviewTradeWithAi } from './ai-trade-review.server';
import { interpretReview, type ReviewOutcome } from './ai-trade-review';

/** AI trade check: re-reads live charts and lets the AI approve or block one autotrader trade. */
export const reviewAutoTrade = createServerFn({ method: 'POST' })
  .inputValidator((i: unknown) => z.object({
    symbol: z.string().min(2).max(32),
    side: z.enum(['BUY', 'SELL']),
    entry: z.number().positive(),
    stopLoss: z.number().positive(),
    takeProfit: z.number().positive(),
    style: z.enum(['scalp', 'normal', 'swing']).optional(),
  }).parse(i))
  .handler(async ({ data }): Promise<ReviewOutcome> => {
    const read = await readTradingView(data.symbol);
    if (!read.ok) return interpretReview(null, read.error ?? 'Live chart unavailable');
    return reviewTradeWithAi(read, { ...data, style: data.style ?? 'normal' }, marketSession(data.symbol));
  });
