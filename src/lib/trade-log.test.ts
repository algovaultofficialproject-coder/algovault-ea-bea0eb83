import { afterEach, describe, expect, it } from "vitest";
import { entriesForView, tradeLog } from "./trade-log";

const texts = () => tradeLog.entries().map((e) => e.text);

describe("trade log wording", () => {
  afterEach(() => { tradeLog.stop(); tradeLog.clear(); });

  it("shows the welcome lines when the bot is switched on", () => {
    tradeLog.start("bot");
    tradeLog.engineOn();
    expect(texts()).toEqual(["Money engine on", "Welcome to the future of automation", "Scanning market........"]);
  });

  it("shows the signal details and executed count out of configured trades", () => {
    tradeLog.start("bot");
    tradeLog.engineOn();
    const id = tradeLog.signal({ symbol: "XAUUSD", side: "BUY", tp: 2410.5, sl: 2395.2 });
    tradeLog.executed(id, 5, 5);
    expect(texts().slice(2)).toEqual([
      "New signal received", "Symbol: XAUUSD", "Direction: Buy", "TP: 2410.5", "SL: 2395.2", "5/5 trades executed",
    ]);
  });

  it("reports partial execution as executed/configured", () => {
    const id = tradeLog.signal({ symbol: "EURUSD", side: "SELL", tp: 1.08, sl: 1.09 });
    tradeLog.executed(id, 3, 5, "Not enough margin");
    expect(texts()).toContain("Direction: Sell");
    expect(texts()).toContain("3/5 trades executed");
  });
});

describe("hold after trades", () => {
  afterEach(() => { tradeLog.stop(); tradeLog.clear(); });

  it("stays on but stops scanning after trades until STOP EA and START", () => {
    tradeLog.start("bot");
    const v = tradeLog.version();
    tradeLog.holdAfterTrade();
    expect(tradeLog.entries().at(-1)?.text).toBe("Trades placed — press STOP EA, then START to scan again");
    expect(tradeLog.canExecute("bot", v)).toBe(false);
    tradeLog.stop();
    tradeLog.start("bot");
    expect(tradeLog.canExecute("bot", tradeLog.version())).toBe(true);
  });
});

describe("trade log window views", () => {
  afterEach(() => { tradeLog.stop(); tradeLog.clear(); });

  it("LIVE shows only signal and execution lines while SCRIPT shows every line", () => {
    tradeLog.start("bot");
    tradeLog.engineOn();
    const id = tradeLog.signal({ symbol: "XAUUSD", side: "BUY", tp: 2410.5, sl: 2395.2 });
    tradeLog.executed(id, 1, 1);
    const all = tradeLog.entries();
    expect(entriesForView(all, "script").map((e) => e.text)).toEqual([
      "Money engine on", "Welcome to the future of automation",
      "New signal received", "Symbol: XAUUSD", "Direction: Buy", "TP: 2410.5", "SL: 2395.2", "1/1 trades executed",
    ]);
    expect(entriesForView(all, "live").map((e) => e.text)).toEqual([
      "New signal received", "Symbol: XAUUSD", "Direction: Buy", "TP: 2410.5", "SL: 2395.2", "1/1 trades executed",
    ]);
  });
});
