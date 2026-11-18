import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runUltraScan } from "./scan-chart.server";
import { SCAN_STRATEGY_IDS } from "./chart-scan-view";
import { normEmail, scanDay, scanLimitFor } from "./scan-quota";

const emailSchema = z.string().trim().email().max(254);

async function usedToday(email: string, day: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("chart_scan_usage").select("used").eq("email", email).eq("day", day).maybeSingle();
  if (error) throw new Error("Could not check today's scans. Try again.");
  return data?.used ?? 0;
}

/** Today's chart scans for the signed-in trading-app email. */
export const getScanUsage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email: emailSchema }).parse(input))
  .handler(async ({ data }) => {
    const email = normEmail(data.email);
    return { used: await usedToday(email, scanDay()), limit: scanLimitFor(email) };
  });

/** Upload scan: the AI reads the chart itself (AutoTrader Pro method); counts against the daily allowance. */
export const scanChart = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        imageDataUrl: z.string().min(20).max(8_000_000),
        strategy: z.enum(SCAN_STRATEGY_IDS).default("auto"),
        symbol: z.string().max(32).optional(),
        email: emailSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Scanner not configured.");
    const email = normEmail(data.email);
    const day = scanDay();
    const limit = scanLimitFor(email);
    if ((await usedToday(email, day)) >= limit) throw new Error(`Daily limit reached — ${limit}/${limit} scans used today. Scans reset at midnight.`);
    const signal = await runUltraScan({ apiKey: key, imageDataUrl: data.imageDataUrl, strategy: data.strategy, symbol: data.symbol });
    // Not a chart → NO TRADE, and it does not use up a daily scan.
    if (signal.noChart) return { ...signal, usage: { used: await usedToday(email, day), limit } };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: used, error } = await supabaseAdmin.rpc("consume_chart_scan", { _email: email, _day: day, _limit: limit });
    if (error) throw new Error("Could not record the scan. Try again.");
    if (used === -1) throw new Error(`Daily limit reached — ${limit}/${limit} scans used today. Scans reset at midnight.`);
    return { ...signal, usage: { used: used as number, limit } };
  });
