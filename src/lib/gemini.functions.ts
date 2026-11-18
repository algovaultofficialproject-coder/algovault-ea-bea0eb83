import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Shared Gemini direction read for a symbol's last closed 15m candle (null when Gemini is unavailable). */
export const getGeminiVerdict = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ symbol: z.string().regex(/^[A-Za-z0-9._-]{2,20}$/) }).parse(i))
  .handler(async ({ data }) => {
    const { geminiVerdict } = await import("./gemini.server");
    try { return await geminiVerdict(data.symbol); } catch { return null; }
  });
