import { describe, expect, it } from "vitest";
import { matchBrokerSymbol, parseSymbolList } from "./broker-symbol";

const ACCOUNT = ["EURUSD.m", "GBPUSD.m", "XAUUSD.m", "XAGUSD.m", "USTEC.m", "BTCUSD.m"];

describe("matchBrokerSymbol", () => {
  it("capital M suffix finds the broker's lowercase .m", () => {
    expect(matchBrokerSymbol("XAUUSD.M", ACCOUNT)).toBe("XAUUSD.m");
  });
  it("plain market name finds the suffixed broker name", () => {
    expect(matchBrokerSymbol("xauusd", ACCOUNT)).toBe("XAUUSD.m");
  });
  it("a different suffix style still finds the market", () => {
    expect(matchBrokerSymbol("EURUSDm", ACCOUNT)).toBe("EURUSD.m");
    expect(matchBrokerSymbol("GBPUSD.pro", ACCOUNT)).toBe("GBPUSD.m");
  });
  it("common names map to the broker's market", () => {
    expect(matchBrokerSymbol("GOLD", ACCOUNT)).toBe("XAUUSD.m");
    expect(matchBrokerSymbol("NAS100", ACCOUNT)).toBe("USTEC.m");
  });
  it("prefers the variant whose suffix was typed", () => {
    expect(matchBrokerSymbol("XAUUSD.M", ["XAUUSD", "XAUUSD.m", "XAUUSD.ecn"])).toBe("XAUUSD.m");
    expect(matchBrokerSymbol("XAUUSD", ["XAUUSD.ecn", "XAUUSD"])).toBe("XAUUSD");
  });
  it("returns null when the account lacks the market", () => {
    expect(matchBrokerSymbol("USDJPY.M", ACCOUNT)).toBeNull();
  });
});

describe("parseSymbolList", () => {
  it("reads strings, objects and name maps", () => {
    expect(parseSymbolList(["A", "B"])).toEqual(["A", "B"]);
    expect(parseSymbolList([{ name: "A" }, { Symbol: "B" }])).toEqual(["A", "B"]);
    expect(parseSymbolList({ "XAUUSD.m": {}, EURUSD: {} })).toEqual(["XAUUSD.m", "EURUSD"]);
  });
});
