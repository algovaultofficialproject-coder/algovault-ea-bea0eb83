import { describe, expect, it } from "vitest";
import { newsBlackout, type MarketEvent } from "./fundamentals";

const at = Date.parse("2026-11-20T13:30:00Z");
const ev = (o: Partial<MarketEvent> = {}): MarketEvent => ({ id: "x", title: "Non-Farm Payrolls", currency: "USD", time: new Date(at).toISOString(), impact: "High", forecast: "", previous: "", ...o });
const min = 60_000;

describe("news blackout", () => {
  it("blocks gold 30 minutes before high-impact USD news", () => expect(newsBlackout([ev()], "XAUUSD", at - 30 * min)).not.toBeNull());
  it("blocks 30 minutes after", () => expect(newsBlackout([ev()], "EURUSD", at + 30 * min)).not.toBeNull());
  it("allows trading 31 minutes before and after", () => {
    expect(newsBlackout([ev()], "XAUUSD", at - 31 * min)).toBeNull();
    expect(newsBlackout([ev()], "XAUUSD", at + 31 * min)).toBeNull();
  });
  it("ignores medium-impact news", () => expect(newsBlackout([ev({ impact: "Medium" })], "XAUUSD", at)).toBeNull());
  it("ignores news for other currencies", () => expect(newsBlackout([ev({ currency: "JPY" })], "EURUSD", at)).toBeNull());
  it("treats NAS100 and US30 as USD", () => {
    expect(newsBlackout([ev()], "NAS100", at)).not.toBeNull();
    expect(newsBlackout([ev()], "US30", at)).not.toBeNull();
  });
  it("never blocks when the calendar is empty", () => expect(newsBlackout([], "XAUUSD", at)).toBeNull());
});
