import { describe, expect, it } from "vitest";
import { SITE_THEME_BOOT_SCRIPT, siteThemeAppliesTo } from "./site-theme";

describe("site theme", () => {
  it("is locked to light with no saved preference", () => {
    expect(SITE_THEME_BOOT_SCRIPT).toContain('dataset.siteTheme="light"');
    expect(SITE_THEME_BOOT_SCRIPT).not.toContain("localStorage");
  });
  it("covers the landing page, sign in/up and the mentor portal", () => {
    for (const p of ["/", "/login", "/signup", "/forgot-password", "/dashboard", "/manage-eas/abc", "/profile", "/key-stats"]) {
      expect(siteThemeAppliesTo(p)).toBe(true);
    }
  });
  it("leaves the trading app, promo sites and tools alone", () => {
    for (const p of ["/ios", "/android", "/autotrader", "/site/my-bot", "/robot/1", "/fundamentals", "/upload-app"]) {
      expect(siteThemeAppliesTo(p)).toBe(false);
    }
  });
});
