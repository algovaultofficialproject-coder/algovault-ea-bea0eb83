import { describe, expect, it } from "vitest";
import { parseGeminiVerdict, refereeAction } from "./gemini-referee";

describe("Gemini referee", () => {
  it("reads Gemini's JSON reply", () => {
    expect(parseGeminiVerdict('```json\n{"side":"buy","confidence":78,"reason":"15m breakout"}\n```')).toEqual({ side: "BUY", confidence: 78, reason: "15m breakout" });
  });
  it("ignores malformed replies", () => {
    expect(parseGeminiVerdict("no idea")).toBeNull();
    expect(parseGeminiVerdict('{"side":"LONG"}')).toBeNull();
  });
  it("overrules a sell when Gemini sees a buy breakout with 60%+", () => {
    expect(refereeAction("SELL", { side: "BUY", confidence: 60, reason: "" })).toBe("follow");
  });
  it("keeps the engine signal when Gemini is under 60%", () => {
    expect(refereeAction("SELL", { side: "BUY", confidence: 59, reason: "" })).toBe("keep");
  });
  it("opens a trade from engine WAIT when Gemini is sure", () => {
    expect(refereeAction("WAIT", { side: "SELL", confidence: 70, reason: "" })).toBe("follow");
  });
  it("keeps the engine signal when Gemini is unavailable or says WAIT", () => {
    expect(refereeAction("BUY", null)).toBe("keep");
    expect(refereeAction("BUY", { side: "WAIT", confidence: 90, reason: "" })).toBe("keep");
  });
  it("marks agreement", () => {
    expect(refereeAction("BUY", { side: "BUY", confidence: 40, reason: "" })).toBe("agree");
  });
});
