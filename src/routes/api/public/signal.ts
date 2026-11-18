import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Manual signal bridge for the MT5 Desktop EA.
 *
 * GET  /api/public/signal?magic=<number>[&key=<bridge_api_key>]
 *   → returns the next unconsumed manual signal for that magic number
 *     and marks it consumed. Empty response when queue is empty.
 *
 * POST /api/public/signal
 *   → optional inbound feed used by a hosted MT5 EA to forward its own
 *     trades (`magic`, `symbol`, `side`, `lot`, …). Requires x-bridge-key
 *     header when BRIDGE_API_KEY is configured.
 *
 * Only two sources are trusted: the desktop EA itself (POST) and the
 * mentor portal's manual signal slot (via authenticated server function).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Key",
};

const InboundSchema = z.object({
  magic: z.coerce.number().int().positive(),
  symbol: z.string().min(1).max(32),
  side: z.enum(["BUY", "SELL", "CLOSE"]).or(z.string().transform((v) => v.toUpperCase())),
  lot: z.coerce.number().positive().optional(),
  entry_price: z.coerce.number().optional(),
  stop_loss: z.coerce.number().optional(),
  take_profit: z.coerce.number().optional(),
  comment: z.string().max(64).optional(),
  owner_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/public/signal")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const magicRaw = url.searchParams.get("magic");
        const magic = magicRaw ? Number(magicRaw) : NaN;
        if (!Number.isFinite(magic) || magic <= 0) {
          return json({ error: "magic required" }, 400);
        }

        // Optional bridge key gate (per-mentor).
        const expected = process.env.BRIDGE_API_KEY;
        if (expected) {
          const provided = url.searchParams.get("key") ?? request.headers.get("x-bridge-key");
          if (provided !== expected) return json({ error: "unauthorized" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // The desktop EA has its own delivery marker (delivered_at) so the phone
        // app consuming a signal (consumed_at) can never starve the hosted EA.
        const fresh = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("manual_signals")
          .select("*")
          .eq("magic", magic)
          .is("delivered_at", null)
          .gte("created_at", fresh)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ ok: true, signal: null }, 200);

        await supabaseAdmin
          .from("manual_signals")
          .update({ delivered_at: new Date().toISOString() })
          .eq("id", data.id);

        return json({
          ok: true,
          signal: {
            id: data.id,
            symbol: data.symbol,
            side: data.side,
            lot: Number(data.lot),
            stop_loss: data.stop_loss,
            take_profit: data.take_profit,
            comment: data.comment,
            created_at: data.created_at,
          },
        }, 200);
      },

      POST: async ({ request }) => {
        const expected = process.env.BRIDGE_API_KEY;
        if (expected && request.headers.get("x-bridge-key") !== expected) {
          return json({ error: "unauthorized" }, 401);
        }
        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
        const parsed = InboundSchema.safeParse(body);
        if (!parsed.success) return json({ error: "invalid", details: parsed.error.issues }, 422);
        const s = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Only accept if an owner_id is provided (proves the desktop EA is registered).
        if (!s.owner_id) return json({ error: "owner_id required" }, 400);

        const { error } = await supabaseAdmin.from("manual_signals").insert({
          owner_id: s.owner_id,
          magic: s.magic,
          symbol: s.symbol.trim(),
          side: s.side as "BUY" | "SELL" | "CLOSE",
          lot: s.lot ?? 0.01,
          stop_loss: s.stop_loss ?? null,
          take_profit: s.take_profit ?? null,
          comment: s.comment ?? "MT5 desktop",
          consumed_at: new Date().toISOString(),
        });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true }, 200);
      },
    },
  },
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
