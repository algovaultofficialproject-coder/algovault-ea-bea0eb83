import { describe, expect, it } from "vitest";
import { clampDiscount, countdownParts, getBotMessage, initials, isValidSlug, parseBenefit, splitTitle, parseFeatures, slugify, telegramLink, whatsappLink, whatsappProblem } from "./promo-site";

describe("promo site helpers", () => {
  it("turns a bot name into a web address part", () => {
    expect(slugify("Neymar Scalper EA")).toBe("neymar-scalper-ea");
    expect(isValidSlug("neymar-scalper-ea")).toBe(true);
  });

  it("rejects addresses that are too short or have odd characters", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("My Bot")).toBe(false);
    expect(isValidSlug("-bot-")).toBe(false);
  });

  it("builds a WhatsApp link from a typed phone number", () => {
    expect(whatsappLink("+27 71 234 5678")).toBe("https://wa.me/27712345678");
    expect(whatsappLink("123")).toBeNull();
  });

  it("accepts 00 country prefixes but refuses local numbers without a country code", () => {
    expect(whatsappLink("0027712345678")).toBe("https://wa.me/27712345678");
    expect(whatsappLink("071 234 5678")).toBeNull();
    expect(whatsappProblem("071 234 5678")).toMatch(/country code/);
    expect(whatsappProblem("+27 71 234 5678")).toBeNull();
    expect(whatsappProblem("")).not.toBeNull();
  });

  it("'Get this bot' opens WhatsApp with a message naming the bot", () => {
    expect(whatsappLink("+27712345678", getBotMessage("Neymar EA"))).toBe(
      "https://wa.me/27712345678?text=Hi%2C%20I%20want%20to%20get%20Neymar%20EA.%20How%20do%20I%20start%3F",
    );
  });

  it("builds a Telegram link from a handle", () => {
    expect(telegramLink("@algovault")).toBe("https://t.me/algovault");
    expect(telegramLink("x")).toBeNull();
  });

  it("keeps at most 8 features, one per line", () => {
    const text = Array.from({ length: 10 }, (_, i) => `- Feature ${i + 1}`).join("\n");
    const out = parseFeatures(text);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("Feature 1");
  });
});

describe("promo site page helpers", () => {
  it("shows the last word of the bot name in the accent colour", () => {
    expect(splitTitle("MASTER CHEF V2+")).toEqual({ lead: "MASTER CHEF", tail: "V2+" });
    expect(splitTitle("Neymar")).toEqual({ lead: "Neymar", tail: "" });
  });

  it("makes two-letter logo initials", () => {
    expect(initials("MASTER CHEF V2+")).toBe("MC");
    expect(initials("neymar")).toBe("NE");
    expect(initials("")).toBe("EA");
  });

  it("counts down to the offer end and hides it once passed", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(countdownParts("2026-01-06T10:49:55Z", now)).toEqual({ days: 5, hours: 10, mins: 49, secs: 55 });
    expect(countdownParts("2025-12-31T00:00:00Z", now)).toBeNull();
    expect(countdownParts(null, now)).toBeNull();
  });

  it("splits a highlight into a title and text", () => {
    expect(parseBenefit("Hands-Free: Runs 24/5 while you sleep")).toEqual({ title: "Hands-Free", text: "Runs 24/5 while you sleep" });
    expect(parseBenefit("Institutional Grade — Built on ICT liquidity")).toEqual({ title: "Institutional Grade", text: "Built on ICT liquidity" });
    expect(parseBenefit("Works on MT5")).toEqual({ title: "Works on MT5", text: "" });
  });

  it("keeps the discount between 0 and 95 percent", () => {
    expect(clampDiscount(50)).toBe(50);
    expect(clampDiscount(120)).toBe(95);
    expect(clampDiscount(-5)).toBe(0);
  });
});
