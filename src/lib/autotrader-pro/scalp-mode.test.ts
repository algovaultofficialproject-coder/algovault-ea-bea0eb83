import { describe, it, expect } from "vitest";
import { pairMode, scalpTarget } from "./scalp-mode";

describe("scalp mode", () => {
  it("defaults to normal", () => {
    expect(pairMode(undefined)).toBe("normal");
    expect(pairMode("scalp")).toBe("scalp");
  });
  it("caps a BUY target at 1R", () => {
    expect(scalpTarget("BUY", 100, 99, 103)).toBe(101);
  });
  it("caps a SELL target at 1R", () => {
    expect(scalpTarget("SELL", 100, 102, 94)).toBe(98);
  });
  it("never goes past the engine target", () => {
    expect(scalpTarget("BUY", 100, 98, 101)).toBe(101);
  });
});
