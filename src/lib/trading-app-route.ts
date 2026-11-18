/** Shared search params and page tags for the trading app addresses (/ios web, /android app). */
export type TradingAppSearch = { email?: string; mentorId?: string };

export const validateTradingAppSearch = (search: Record<string, unknown>): TradingAppSearch => ({
  email: typeof search.email === "string" ? search.email : "",
  mentorId: typeof search.mentorId === "string" || typeof search.mentorId === "number" ? String(search.mentorId) : "",
});

export const tradingAppHead = (title: string, description: string) => () => ({
  meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ],
  links: [
    { rel: "manifest", href: "/manifest.webmanifest" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.jpg" },
  ],
});
