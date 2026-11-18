import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ALWAYS_OPEN = new Set(["t16t85hql9f@gmail.com"]);

/** Emails a trade signal to the email used to open the trading app (must be a known app email). */
export const emailSignal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    to: z.string().email().max(254),
    symbol: z.string().min(2).max(32), side: z.enum(["BUY", "SELL"]),
    entry: z.number(), sl: z.number(), tp: z.number(),
    confidence: z.number().min(0).max(100), reasons: z.array(z.string().max(80)).max(12),
  }).parse(i))
  .handler(async ({ data }) => {
    const to = data.to.trim().toLowerCase();
    if (!ALWAYS_OPEN.has(to)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin.from("activated_emails").select("email").eq("email", to).maybeSingle();
      if (!row) return { sent: false };
    }
    const { sendGmail } = await import("./gmail.server");
    return sendGmail(to, `${data.side} ${data.symbol} signal · ${data.confidence}%`, [
      `New 15m ${data.side} signal on ${data.symbol}.`,
      `Entry: ${data.entry}`, `Stop loss: ${data.sl}`, `Take profit: ${data.tp}`,
      `Confidence: ${data.confidence}%`,
      ...(data.reasons.length ? [`Why: ${data.reasons.join(", ")}`] : []),
    ]);
  });
