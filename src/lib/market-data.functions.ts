import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCandles } from "./market-data.server";

/** Real OHLC history for the AutoTrader Pro engine and backtests (see market-data.server.ts for sources). */
export const getCandles = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    symbol: z.string().min(2).max(32),
    interval: z.enum(["1m", "5m", "15m", "30m", "1h"]),
    limit: z.number().int().min(100).max(1200).default(600),
  }).parse(i))
  .handler(({ data }) => loadCandles(data.symbol, data.interval, data.limit));
