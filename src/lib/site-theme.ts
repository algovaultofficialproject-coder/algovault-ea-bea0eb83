/** Landing, mentor sign-in/up and mentor portal are locked to light mode, separate from the trading app's theme. */
export type SiteTheme = "light";

const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];
const PORTAL_PREFIXES = [
  "/dashboard", "/generate-key", "/manage-eas", "/signals", "/bridge-keys", "/ndmemail", "/users",
  "/promo-site", "/key-stats", "/profile", "/activate", "/reactivate", "/bot-editor",
];

/** True for pages that follow the site theme; the trading app, promo sites and tools keep their own look. */
export function siteThemeAppliesTo(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || AUTH_PATHS.includes(path)) return true;
  return PORTAL_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}.`));
}

/** Runs before paint so the site pages always render light, even if a dark choice was saved before. */
export const SITE_THEME_BOOT_SCRIPT = `try{document.documentElement.dataset.siteTheme="light";}catch(e){}`;
