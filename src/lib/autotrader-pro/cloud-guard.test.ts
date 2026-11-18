import { describe, expect, it } from "vitest";
import { mergeEvents, planExits, symbolsToRead, unseenEvents } from "./cloud-guard";
import type { FrameRead } from "./position-guard";

const t = (ticket: string, profit: number, comment = "AlgoVault Pro", type = "Buy", symbol = "XAUUSD") => ({ ticket, symbol, type, profit, comment });
const bear = (interval: FrameRead["interval"]): FrameRead => ({ interval, direction: "bearish", regime: "weak_bear", earlyTransition: null, exhaustion: { stage: "none", trend: 0 } } as unknown as FrameRead);

describe("24/7 guard planning", () => {
  it("only reads candles for AlgoVault trades in profit", () => {
    expect(symbolsToRead([t("1", 5), t("2", -3, "AlgoVault", "Buy", "EURUSD"), t("3", 9, "manual", "Buy", "BTCUSD")])).toEqual(["XAUUSD"]);
  });
  it("never closes a trade in loss or a trade not placed by AlgoVault", () => {
    const p = planExits([t("1", -2), t("2", 8, "my own trade")], { XAUUSD: [bear("5m"), bear("15m")] });
    expect(p.due).toEqual([]);
  });
  it("closes a profitable AlgoVault buy when 5m and 15m turn against it", () => {
    const p = planExits([t("1", 12)], { XAUUSD: [bear("1m"), bear("5m"), bear("15m")] });
    expect(p.due.map((d) => d.ticket)).toEqual(["1"]);
  });
  it("does not judge without market data", () => {
    expect(planExits([t("1", 12)], {}).due).toEqual([]);
  });
  it("keeps the event list capped and shows each close once", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ at: i, text: `e${i}`, kind: "closed" as const }));
    const merged = mergeEvents([], many);
    expect(merged.length).toBe(20);
    expect(mergeEvents(merged, [merged[0]]).length).toBe(20);
    expect(unseenEvents(merged, 27).map((e) => e.at)).toEqual([28, 29]);
  });
});
