import { describe, expect, it } from "vitest";
import { typingHistory, typingStep, visibleText, charsPerTick, type TypingState } from "@/lib/typewriter";

const run = (s: TypingState, lines: { id: string; text: string }[], ticks: number) => {
  for (let i = 0; i < ticks; i++) s = typingStep(s, lines);
  return s;
};

describe("Trade Log typing", () => {
  it("types a new line one character at a time", () => {
    const lines = [{ id: "a", text: "BUY" }];
    let s = typingHistory([]);
    s = typingStep(s, lines);
    expect(visibleText(s, lines[0])).toBe("B");
    s = typingStep(s, lines);
    expect(visibleText(s, lines[0])).toBe("BU");
    s = typingStep(s, lines);
    expect(visibleText(s, lines[0])).toBe("BUY");
  });

  it("types lines one after another, not at the same time", () => {
    const lines = [{ id: "a", text: "abc" }, { id: "b", text: "xyz" }];
    let s = run(typingHistory([]), lines, 2);
    expect(visibleText(s, lines[0])).toBe("ab");
    expect(visibleText(s, lines[1])).toBeNull();
    s = run(s, lines, 2);
    expect(visibleText(s, lines[0])).toBe("abc");
    expect(visibleText(s, lines[1])).toBe("x");
  });

  it("shows lines already in the log at once", () => {
    const lines = [{ id: "a", text: "old line" }];
    expect(visibleText(typingHistory(lines), lines[0])).toBe("old line");
  });

  it("updates a finished live line instantly when its text changes", () => {
    const s = run(typingHistory([]), [{ id: "a", text: "Scanning" }], 8);
    expect(visibleText(s, { id: "a", text: "Scanning market" })).toBe("Scanning market");
  });

  it("speeds up only when a long queue builds", () => {
    expect(charsPerTick(50)).toBe(1);
    expect(charsPerTick(600)).toBe(5);
    expect(charsPerTick(5000)).toBe(6);
  });
});
