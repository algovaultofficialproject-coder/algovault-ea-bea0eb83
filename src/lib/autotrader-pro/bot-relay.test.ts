import { describe, expect, it } from "vitest";
import { rowRelaySignal } from "./bot-relay";

const row = { symbol: "XAUUSD", side: "SELL" as const, decision: "SELL_STOP" as const, lots: 0.05, sl: 2360, tps: [2340, 2330, 2320, 2310] as [number, number, number, number], key: "k1", data: "live" as const };
const none = new Set<string>();

describe("rowRelaySignal", () => {
  it("sends a sell stop signal straight away as a SELL with its stop and TP2", () => {
    expect(rowRelaySignal(row, none)).toMatchObject({ symbol: "XAUUSD", side: "SELL", lot: 0.05, stop_loss: 2360, take_profit: 2330 });
  });
  it("sends a buy limit signal as a BUY", () => {
    expect(rowRelaySignal({ ...row, side: "BUY", decision: "BUY_LIMIT" }, none)?.side).toBe("BUY");
  });
  it("never sends the same signal twice", () => {
    expect(rowRelaySignal(row, new Set(["k1"]))).toBeNull();
  });
  it("never sends WAIT or REJECT rows", () => {
    expect(rowRelaySignal({ ...row, decision: "WAIT" }, none)).toBeNull();
    expect(rowRelaySignal({ ...row, decision: "REJECT" }, none)).toBeNull();
  });
  it("never sends a signal without live market data", () => {
    expect(rowRelaySignal({ ...row, data: "unavailable" }, none)).toBeNull();
  });
});
