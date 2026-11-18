import { describe, expect, it } from "vitest";
import { automaticStops } from "./auto-stops";
import { renderGmailEmail } from "./gmail-template";

describe("automatic stops", () => {
  it("uses three times slower-chart volatility in both directions", () => {
    expect(automaticStops(2000, "BUY", 2, 5)).toEqual({ sl: 1985, tp: 2030 });
    expect(automaticStops(2000, "SELL", 2, 5)).toEqual({ sl: 2015, tp: 1970 });
  });
  it("keeps a minimum distance and skips missing data", () => {
    expect(automaticStops(2000, "BUY", 0.1, 0.2)?.sl).toBe(1994);
    expect(automaticStops(2000, "BUY", 0, 0)).toBeNull();
    expect(automaticStops(NaN, "BUY", 2, 5)).toBeNull();
  });
});

describe("Gmail notices", () => {
  it("escapes recipient data and includes branded layout", () => {
    const html = renderGmailEmail("Account <notice>", ["<script>unsafe</script>"]);
    expect(html).toContain("Algo Vault EA");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('role="presentation"');
  });
});