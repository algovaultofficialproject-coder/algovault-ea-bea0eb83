import { describe, expect, test } from "bun:test";
import { canAddMentorBot, MENTOR_BOT_LIMIT, validateMentorBots } from "./mentor-bot-limit.ts";

describe("one bot per mentor", () => {
  test("allows only one bot", () => {
    expect(MENTOR_BOT_LIMIT).toBe(1);
    expect(canAddMentorBot([])).toBe(true);
    expect(canAddMentorBot([{ id: "a" }])).toBe(false);
    expect(() => validateMentorBots([{ id: "a" }, { id: "b" }], [{ id: "a" }])).toThrow();
  });
  test("preserves legacy bots while allowing deletion but not additions", () => {
    const old = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(() => validateMentorBots(old.slice(0, 2), old)).not.toThrow();
    expect(() => validateMentorBots([...old, { id: "d" }], old)).toThrow();
  });
});
