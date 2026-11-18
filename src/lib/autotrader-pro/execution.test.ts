import { describe, expect, it } from "vitest";
import { connectedAccount, MAX_TRADES_PER_EXECUTION, parseTradeCount } from "./execution";

const portal = { metaPlatform: "mt4" as const, metaLogin: "12345", metaPassword: "pw", metaServer: "Exness-MT4Real", metaBroker: "Exness" };

describe("AutoTrader Pro execution account and trade count", () => {
  it("uses the account connected on the Metatrader tab, on its own platform", () => {
    const a = connectedAccount(portal);
    expect(a?.platform).toBe("mt4");
    expect(a?.login).toBe("12345");
    expect(a?.server).toBe("Exness-MT4Real");
    expect(a?.label).toBe("MT4 · Exness #12345");
  });

  it("has no account to execute on when nothing is connected", () => {
    expect(connectedAccount({ ...portal, metaLogin: null })).toBeNull();
    expect(connectedAccount({ ...portal, metaPassword: null })).toBeNull();
  });

  it("requires a whole number of trades from 1 to 20 before execution", () => {
    expect(MAX_TRADES_PER_EXECUTION).toBe(20);
    expect(parseTradeCount("3")).toBe(3);
    expect(parseTradeCount("20")).toBe(20);
    expect(parseTradeCount("")).toBeNull();
    expect(parseTradeCount("0")).toBeNull();
    expect(parseTradeCount("21")).toBeNull();
    expect(parseTradeCount("1.5")).toBeNull();
    expect(parseTradeCount(null)).toBeNull();
  });
});
