import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  symbol: z.string().min(1).max(32),
  side: z.enum(["BUY", "SELL"]),
  entry: z.number(),
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
  context: z.string().max(2000).optional(),
});

const Verdict = z.object({
  verdict: z.enum(["execute", "skip", "review"]),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().max(280),
  riskReward: z.number().optional(),
});

/** Fast AI gate that pre-screens incoming signals before they hit the bridge. */
export const checkSignal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI gateway not configured");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash-lite");

    const { output } = await generateText({
      model,
      output: Output.object({ schema: Verdict }),
      messages: [
        { role: "system", content: "You are a fast pre-trade risk gate. Validate a signal in <1s. Reject if SL/TP missing, R:R below 1, or symbol obviously wrong. Return strict JSON." },
        { role: "user", content: JSON.stringify(data) },
      ],
    });
    return output;
  });
