import { describe, it, expect } from "vitest";
import { selectionAfterRemoval } from "./robot-selection";
import { tradeLog } from "./trade-log";

describe("robot removal", () => {
  const robots = [{ id: "one" }, { id: "two" }];
  it("selects the other robot without removing it", () => {
    expect(selectionAfterRemoval(robots, "one", "one")).toEqual({ remaining: [{ id: "two" }], activeId: "two" });
  });
  it("keeps the active robot when an inactive robot is removed", () => {
    expect(selectionAfterRemoval(robots, "one", "two").activeId).toBe("one");
  });
  it("clears selection only when the final robot is removed", () => {
    expect(selectionAfterRemoval([{ id: "one" }], "one", "one")).toEqual({ remaining: [], activeId: null });
  });
});
describe("explicit robot start", () => {
  it("does not allow orders while stopped", () => {
    tradeLog.stop();
    expect(tradeLog.canExecute("one", tradeLog.version())).toBe(false);
  });
  it("only authorizes the robot explicitly started", () => {
    tradeLog.start("one");
    expect(tradeLog.canExecute("one", tradeLog.version())).toBe(true);
    expect(tradeLog.canExecute("two", tradeLog.version())).toBe(false);
  });
  it("invalidates an in-flight scan after stop and restart", () => {
    tradeLog.start("one");
    const version = tradeLog.version();
    tradeLog.stop(); tradeLog.start("one");
    expect(tradeLog.canExecute("one", version)).toBe(false);
    tradeLog.stop();
  });
});