/** Pure helpers shared by the mentor promo-site editor and the public page. */

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const PROMO_ACCENTS = {
  azure: { label: "Azure", main: "#007fff", glow: "#4da6ff" },
  emerald: { label: "Emerald", main: "#10b981", glow: "#5eead4" },
  gold: { label: "Gold", main: "#f5b301", glow: "#fde68a" },
  crimson: { label: "Crimson", main: "#e63946", glow: "#ff8a94" },
  violet: { label: "Violet", main: "#8b5cf6", glow: "#c4b5fd" },
} as const;

export type PromoAccent = keyof typeof PROMO_ACCENTS;

export function isPromoAccent(v: string): v is PromoAccent {
  return Object.prototype.hasOwnProperty.call(PROMO_ACCENTS, v);
}

/** Turn a bot name into a web address part: "Neymar Scalper EA" → "neymar-scalper-ea". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * International WhatsApp digits from a typed number ("+27 71 234 5678",
 * "0027712345678"). Local numbers starting with 0 have no country code, so
 * WhatsApp cannot open them — those return null.
 */
export function whatsappDigits(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("0")) return null;
  return digits;
}

/** Problem with the mentor's WhatsApp number, or null when it is usable. */
export function whatsappProblem(phone: string): string | null {
  if (!phone.trim()) return "Add your WhatsApp number so visitors can reach you.";
  if (whatsappDigits(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && !phone.trim().startsWith("+")) {
    return "Add your country code, e.g. +27 71 234 5678 instead of 071 234 5678.";
  }
  return "That WhatsApp number doesn't look right. Use the format +27 71 234 5678.";
}

/** wa.me link from any typed phone number; null when it can't be opened. */
export function whatsappLink(phone: string, text?: string): string | null {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}

/** The message a visitor sends when they tap "Get this bot". */
export function getBotMessage(botName: string): string {
  return `Hi, I want to get ${botName}. How do I start?`;
}

/** t.me link from "@name", "name" or a full t.me URL; null when unusable. */
export function telegramLink(handle: string): string | null {
  const name = handle.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{4,32}$/.test(name)) return null;
  return `https://t.me/${name}`;
}

/** Split the features box (one per line) into at most 8 clean items. */
export function parseFeatures(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => l.slice(0, 120));
}

/** Split a bot name so the last word can be shown in the accent colour. */
export function splitTitle(name: string): { lead: string; tail: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { lead: words.join(" "), tail: "" };
  return { lead: words.slice(0, -1).join(" "), tail: words[words.length - 1] };
}

/** Up to two capital letters for the round logo when there is no picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  if (words.length === 0) return "EA";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export type Countdown = { days: number; hours: number; mins: number; secs: number };

/** Time left until the offer ends; null when there is no end date or it has passed. */
export function countdownParts(endsAt: string | null | undefined, nowMs: number): Countdown | null {
  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  let left = Math.floor((end - nowMs) / 1000);
  if (left <= 0) return null;
  const days = Math.floor(left / 86400); left -= days * 86400;
  const hours = Math.floor(left / 3600); left -= hours * 3600;
  const mins = Math.floor(left / 60);
  return { days, hours, mins, secs: left - mins * 60 };
}

/** "Hands-Free: Runs 24/5" → title + text. A line without a separator is just a title. */
export function parseBenefit(line: string): { title: string; text: string } {
  const m = line.match(/^(.{2,60}?)\s*(?::|\s[—–-]\s)\s*(.+)$/);
  if (m) return { title: m[1].trim(), text: m[2].trim() };
  return { title: line.trim(), text: "" };
}

/** Clamp a typed discount to the allowed 0–95 %. */
export function clampDiscount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, Math.round(value)));
}

export type MiniCandle = { o: number; c: number; h: number; l: number };

/** Decorative, repeatable candle shapes for the phone picture (not market data). */
export function miniCandles(seed: string, count = 18): MiniCandle[] {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out: MiniCandle[] = [];
  let price = 50;
  for (let i = 0; i < count; i++) {
    const o = price;
    const c = Math.max(10, Math.min(90, o + (rnd() - 0.42) * 12));
    out.push({ o, c, h: Math.min(98, Math.max(o, c) + rnd() * 5), l: Math.max(2, Math.min(o, c) - rnd() * 5) });
    price = c;
  }
  return out;
}
