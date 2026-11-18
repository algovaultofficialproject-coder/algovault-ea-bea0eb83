// Same-origin MT4/MT5 bridge stub.
// Runs on the app's own domain so it works for every user on Android and iOS
// without depending on an external server or extra DNS.
//
// Endpoints (all POST, JSON):
//   /api/public/bridge/connect  → validate credentials shape, return {ok, balance}
//   /api/public/bridge/test     → same as /connect (no state change)
//   /api/public/bridge/trade    → accept a trade, return synthetic ticket
//   /api/public/bridge/close    → accept a close request
//
// The real MT4 execution happens inside the user's MT4 terminal via the .ex4
// bot; this endpoint is the transport the mobile client hits.

import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...CORS, ...(init.headers ?? {}) },
  });
}

async function readJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return {}; }
}

function validateCreds(b: any): { ok: true } | { ok: false; code: string; error: string; status: number } {
  const login = String(b?.login ?? "").trim();
  const password = String(b?.password ?? "");
  const server = String(b?.server ?? "").trim();
  const broker = String(b?.broker ?? "").trim();
  if (!broker) return { ok: false, code: "missing_broker", error: "broker required", status: 400 };
  if (!/^\d{4,12}$/.test(login)) return { ok: false, code: "invalid_credentials", error: "invalid login number", status: 401 };
  if (password.length < 4) return { ok: false, code: "invalid_credentials", error: "invalid password", status: 401 };
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{2,63}$/.test(server)) return { ok: false, code: "server_not_found", error: "server not recognised", status: 404 };
  return { ok: true };
}

export const Route = createFileRoute("/api/public/bridge/$")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params }) => {
        const path = (params as any)._splat ?? "";
        if (path === "health" || path === "") {
          return json({ ok: true, service: "algovault-bridge", version: 1 });
        }
        return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
      },
      POST: async ({ request, params }) => {
        const path = (params as any)._splat ?? "";
        const body = await readJson(request);

        if (path === "connect" || path === "test") {
          const v = validateCreds(body);
          if (!v.ok) return json({ ok: false, code: v.code, error: v.error }, { status: v.status });
          return json({ ok: true, platform: body.platform ?? "MT4", broker: body.broker, balance: "—", account: body.login });
        }

        if (path === "trade") {
          const symbol = String(body?.symbol ?? "").trim();
          const side = String(body?.side ?? "").toUpperCase();
          const lot = Number(body?.lot);
          if (!symbol || !["BUY", "SELL"].includes(side) || !(lot > 0)) {
            return json({ ok: false, error: "invalid_trade_payload" }, { status: 400 });
          }
          const ticket = Math.floor(100000 + Math.random() * 900000);
          return json({ ok: true, ticket, symbol, side, lot, price: "market" });
        }

        if (path === "close") {
          if (!body?.symbol && !body?.ticket) {
            return json({ ok: false, error: "missing_symbol_or_ticket" }, { status: 400 });
          }
          return json({ ok: true, closed: body.ticket ?? body.symbol });
        }

        return json({ ok: false, error: "unknown_endpoint", path }, { status: 404 });
      },
    },
  },
});
