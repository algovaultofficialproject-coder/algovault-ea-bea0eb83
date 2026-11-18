import type { CSSProperties } from "react";
import { useSyncExternalStore, useEffect } from "react";
import { canAddMentorBot } from "./mentor-bot-limit";
import { tradeLog } from "./trade-log";
import { selectionAfterRemoval } from "./robot-selection";
import { expiredBotIds, licenseExpiresAt } from "./license-expiry";

export interface SymbolConfig {
  symbol: string;
  lotSize: string;
  action: string;     // BUY / SELL / BOTH
  platform: string;   // MT4
  allowed: boolean;
  trades?: string;    // how many trades to fire per signal
  mode?: "normal" | "scalp"; // scalp = Profit Sniper quick 1R target
}


export interface EA {
  id: string;
  name: string;
  /** 10-digit bot code — used as the signal channel / magic number. */
  code?: string;
  users: number;
  active: number;
  image?: string | null;
  backgroundVideo?: string | null;
  symbols: SymbolConfig[];
  /** Licensed bots only: when the licence ends (null = lifetime). Unset for the mentor's own bots. */
  expiresAt?: number | null;
}

/** Stable 10-digit bot code (deterministic per bot id, so it never changes). */
export function botCodeFor(eaId: string): string {
  let h = 2166136261;
  for (let i = 0; i < eaId.length; i++) h = (Math.imul(h ^ eaId.charCodeAt(i), 16777619) >>> 0);
  const n = 1000000000 + (h % 9000000000);
  return String(n);
}


export interface License {
  id: string;
  key: string;
  userName: string;
  ea: string;
  duration: string;
  createdAt: number;
  active: boolean;
}

export interface MentorAccount {
  id: string;
  mentorId: string;
  email: string;
  active: boolean;
  createdAt: number;
}

export interface ThemePreset {
  id: string;
  label: string;
  primary: string;
  glow: string;
  bg: string;
  swatch: string;
}

export const THEMES: ThemePreset[] = [
  { id: "red",    label: "Crimson",   primary: "oklch(0.63 0.24 27)",  glow: "oklch(0.70 0.26 27)",  bg: "oklch(0.16 0.012 25)",  swatch: "#e63946" },
  { id: "blue",   label: "Azure",     primary: "oklch(0.62 0.22 250)", glow: "oklch(0.70 0.22 250)", bg: "oklch(0.16 0.020 250)", swatch: "#3b82f6" },
  { id: "green",  label: "Emerald",   primary: "oklch(0.68 0.18 150)", glow: "oklch(0.75 0.20 150)", bg: "oklch(0.16 0.020 150)", swatch: "#10b981" },
  { id: "violet", label: "Violet",    primary: "oklch(0.62 0.22 295)", glow: "oklch(0.70 0.24 295)", bg: "oklch(0.16 0.020 295)", swatch: "#8b5cf6" },
  { id: "gold", label: "Gold", primary: "#f5b301", glow: "#f5b301", bg: "oklch(0.16 0.015 85)", swatch: "#f5b301" },
  { id: "orange", label: "Orange", primary: "#f97316", glow: "#f97316", bg: "oklch(0.16 0.015 50)", swatch: "#f97316" },
  { id: "pink", label: "Pink", primary: "#ec4899", glow: "#ec4899", bg: "oklch(0.16 0.015 350)", swatch: "#ec4899" },
  { id: "cyan", label: "Cyan", primary: "#06b6d4", glow: "#06b6d4", bg: "oklch(0.16 0.015 210)", swatch: "#06b6d4" },
  { id: "teal", label: "Teal", primary: "#14b8a6", glow: "#14b8a6", bg: "oklch(0.16 0.015 180)", swatch: "#14b8a6" },
  { id: "lime", label: "Lime", primary: "#84cc16", glow: "#84cc16", bg: "oklch(0.16 0.015 130)", swatch: "#84cc16" },
  { id: "magenta", label: "Magenta", primary: "#d946ef", glow: "#d946ef", bg: "oklch(0.16 0.015 320)", swatch: "#d946ef" },
  { id: "sky", label: "Sky", primary: "#38bdf8", glow: "#38bdf8", bg: "oklch(0.16 0.015 230)", swatch: "#38bdf8" },
  { id: "silver", label: "Silver", primary: "#cbd5e1", glow: "#cbd5e1", bg: "oklch(0.16 0.015 250)", swatch: "#cbd5e1" },
  { id: "amber", label: "Amber", primary: "#f59e0b", glow: "#f59e0b", bg: "oklch(0.16 0.015 70)", swatch: "#f59e0b" },
];

import homeV1 from "@/assets/home-styles/home-v1.jpg.asset.json";
import homeV2 from "@/assets/home-styles/home-v2.jpg.asset.json";
import homeV3 from "@/assets/home-styles/home-v3.jpg.asset.json";
import homeV4 from "@/assets/home-styles/home-v4.jpg.asset.json";
import homeV5 from "@/assets/home-styles/home-v5.jpg.asset.json";
import homeV6 from "@/assets/home-styles/home-v6.jpg.asset.json";

export const HOME_STYLES = [
  { id: "v1", label: "V1 Classic",    sub: "Team Nqobza poster",           thumb: homeV1.url },
  { id: "v2", label: "V2 Standby",    sub: "Portrait + Add Robot",         thumb: homeV2.url },
  { id: "v3", label: "V3 Circle",     sub: "Pairs & Info dial",            thumb: homeV3.url },
  { id: "v4", label: "V4 Trading",    sub: "Segmented cinema",             thumb: homeV4.url },
  { id: "v5", label: "V5 Connect",    sub: "Connect Robot band",           thumb: homeV5.url },
  { id: "v6", label: "V6 Old School", sub: "Powered by Algo Vault EA", thumb: homeV6.url },
] as const;

/**
 * Main interface skins for the downloadable Android / iOS home screen.
 * Each entry drives the generic skin renderer (portrait shape + layout + glow).
 */
export type MainInterfaceSkin = {
  id: string;
  label: string;
  sub: string;
  layout: "portrait" | "hero" | "orbit" | "panel" | "stack";
  shape: "circle" | "rounded" | "square" | "hex";
  glow: "soft" | "hard" | "neon" | "none";
  surface: "matrix" | "aurora" | "carbon" | "glass" | "grid" | "flat";
  accentText?: boolean;
};

const SKIN_NAMES: Record<string, [string, string]> = {
  m2: ["Default", "Portrait with robot list and licence key"],
  m4: ["Matrix", "Large portrait with Connect EA"],
  m6: ["Phoenix", "Portrait with Edge EA connect list"],
  m7: ["Crimson", "Robot card with status light"],
  m8: ["New School", "Full mentor portrait with action pills"],
  m9: ["Showcase", "Portrait, controls and full artwork card"],
  m10: ["Neon Pulse", "Double halo portrait with a glowing start orb"],
  m13: ["Arc Reactor", "Spinning arc portrait with a wide start bar"],
  m14: ["Cipher", "Full artwork card with a glowing add robot bar"],
  m15: ["Hologram", "Scanning hologram frame with a pill control bar"],
  m16: ["Nova", "Ringed portrait with stacked pills and mic circle"],
};
/** Interfaces drawn by ExtraInterfaceHome; unknown saved picks fall back to Default; the originals stay in MainInterfaceHome. */
import { EXTRA_INTERFACE_IDS } from "./interface-ids";
export { EXTRA_INTERFACE_IDS };
export const MAIN_INTERFACES: MainInterfaceSkin[] = ["m2", "m4", "m6", "m7", "m8", "m9", ...EXTRA_INTERFACE_IDS, "m16"].map((id) => ({
  id, label: SKIN_NAMES[id][0], sub: SKIN_NAMES[id][1], layout: "portrait", shape: "circle", glow: "neon", surface: "flat",
}));

export type HomeStyleId = string;

/**
 * Home-screen background images. Every layer is built from the live --primary
 * token, so switching Interface Colour recolours the background instantly.
 */
export const BACKGROUNDS: Array<{ id: string; label: string; css: CSSProperties }> = [
  { id: "none", label: "None", css: {} },
  {
    id: "nebula", label: "Nebula",
    css: {
      backgroundImage: [
        "radial-gradient(ellipse 80% 60% at 20% 10%, color-mix(in oklab, var(--primary) 55%, transparent), transparent 65%)",
        "radial-gradient(ellipse 70% 50% at 85% 80%, color-mix(in oklab, var(--primary) 35%, transparent), transparent 70%)",
      ].join(","),
    },
  },
  {
    id: "matrix-rain", label: "Matrix Rain",
    css: {
      backgroundImage: [
        "radial-gradient(ellipse 60% 40% at 50% 20%, color-mix(in oklab, var(--primary) 40%, transparent), transparent 70%)",
        "repeating-linear-gradient(180deg, color-mix(in oklab, var(--primary) 22%, transparent) 0 2px, transparent 2px 16px)",
      ].join(","),
    },
  },
  {
    id: "grid", label: "Neon Grid",
    css: {
      backgroundImage: [
        "linear-gradient(color-mix(in oklab, var(--primary) 18%, transparent) 1px, transparent 1px)",
        "linear-gradient(90deg, color-mix(in oklab, var(--primary) 18%, transparent) 1px, transparent 1px)",
      ].join(","),
      backgroundSize: "30px 30px, 30px 30px",
    },
  },
  {
    id: "circuit", label: "Circuit",
    css: {
      backgroundImage: [
        "repeating-linear-gradient(45deg, color-mix(in oklab, var(--primary) 14%, transparent) 0 2px, transparent 2px 12px)",
        "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--primary) 10%, transparent) 0 2px, transparent 2px 18px)",
      ].join(","),
    },
  },
  {
    id: "aurora", label: "Aurora",
    css: {
      backgroundImage: [
        "linear-gradient(160deg, color-mix(in oklab, var(--primary) 45%, transparent), transparent 55%)",
        "radial-gradient(ellipse 90% 50% at 50% 100%, color-mix(in oklab, var(--primary) 40%, transparent), transparent 70%)",
      ].join(","),
    },
  },
  {
    id: "pulse-rings", label: "Pulse Rings",
    css: {
      backgroundImage:
        "repeating-radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--primary) 22%, transparent) 0 1px, transparent 1px 34px)",
    },
  },
  {
    id: "hex", label: "Hex Mesh",
    css: {
      backgroundImage: [
        "repeating-linear-gradient(60deg, color-mix(in oklab, var(--primary) 16%, transparent) 0 1px, transparent 1px 26px)",
        "repeating-linear-gradient(-60deg, color-mix(in oklab, var(--primary) 16%, transparent) 0 1px, transparent 1px 26px)",
      ].join(","),
    },
  },
  {
    id: "scanline", label: "Scanline",
    css: {
      backgroundImage: [
        "linear-gradient(180deg, color-mix(in oklab, var(--primary) 30%, transparent), transparent 45%)",
        "repeating-linear-gradient(180deg, color-mix(in oklab, var(--primary) 12%, transparent) 0 1px, transparent 1px 5px)",
      ].join(","),
    },
  },
  {
    id: "vault", label: "Vault Glow",
    css: {
      backgroundImage: [
        "radial-gradient(circle at 50% 0%, color-mix(in oklab, var(--primary) 60%, transparent), transparent 55%)",
        "radial-gradient(circle at 50% 100%, color-mix(in oklab, var(--primary) 30%, transparent), transparent 60%)",
      ].join(","),
    },
  },
  {
    id: "carbon", label: "Carbon Neon",
    css: {
      backgroundImage: [
        "repeating-linear-gradient(90deg, color-mix(in oklab, var(--primary) 10%, transparent) 0 1px, transparent 1px 8px)",
        "radial-gradient(ellipse 70% 60% at 50% 50%, color-mix(in oklab, var(--primary) 25%, transparent), transparent 70%)",
      ].join(","),
    },
  },
  {
    id: "storm", label: "Storm",
    css: {
      backgroundImage: [
        "conic-gradient(from 210deg at 30% 20%, color-mix(in oklab, var(--primary) 40%, transparent), transparent 40%)",
        "radial-gradient(ellipse 80% 50% at 70% 90%, color-mix(in oklab, var(--primary) 30%, transparent), transparent 70%)",
      ].join(","),
    },
  },
];
export type BackgroundId = string;




export const AVATAR_SHAPES = ["circle", "rounded", "square", "hexagon"] as const;
export type AvatarShape = typeof AVATAR_SHAPES[number];

/** Bot-name fonts (loaded in the root route head). */
export const UI_FONTS = [
  { id: "default", label: "Default", css: "'Space Grotesk', Arial, sans-serif", style: "normal", weight: "700" },
  { id: "fiesta", label: "Fiesta", css: "'Audiowide', sans-serif", style: "normal", weight: "400" },
  { id: "turbo", label: "Turbo", css: "'Racing Sans One', sans-serif", style: "italic", weight: "400" },
  { id: "technology", label: "Technology", css: "'Exo 2', sans-serif", style: "italic", weight: "800" },
  { id: "technology2", label: "Technology 2", css: "'Titillium Web', sans-serif", style: "italic", weight: "700" },
  { id: "hkmodular", label: "HK Modular", css: "'Orbitron', sans-serif", style: "normal", weight: "800" },
  { id: "glitch", label: "Rubik Glitch", css: "'Rubik Glitch', sans-serif", style: "normal", weight: "400" },
] as const;
export type UiFontId = typeof UI_FONTS[number]["id"];

interface State {
  eas: EA[];
  licenses: License[];
  mentorAccounts: MentorAccount[];
  reactivatedEmails: string[];
  maxLicenses: number;
  profileImage: string | null;
  themeId: string;
  homeStyle: HomeStyleId;
  bgId: BackgroundId;
  bgAnim: boolean;
  avatarShape: AvatarShape;
  uiFont: UiFontId;
  activeEAId: string | null;
  brokerConnected: boolean;
  bridgeUrl: string;
  activatedEmail: string | null;
  metaAccountId: string | null;
  metaPlatform: "mt4" | "mt5" | null;
  metaLogin: string | null;
  metaBroker: string | null;
  metaPassword: string | null;
  metaServer: string | null;
}

const listeners = new Set<() => void>();

const initial: State = {
  // New accounts start with no bots — they only appear once the user creates them.
  eas: [],
  licenses: [],
  mentorAccounts: [],
  reactivatedEmails: [],
  maxLicenses: 500,
  profileImage: null,
  themeId: "red",
  homeStyle: "m1",
  bgId: "nebula",
  bgAnim: true,
  avatarShape: "circle",
  uiFont: "default",
  activeEAId: null,
  brokerConnected: false,
  bridgeUrl: "",
  activatedEmail: null,
  metaAccountId: null,
  metaPlatform: null,
  metaLogin: null,
  metaBroker: null,
  metaPassword: null,
  metaServer: null,
};

/** localStorage key — scoped per signed-in account so accounts never share bots. */
let scopeKey = "tp.portal";
const keyFor = (uid: string | null) => (uid ? `tp.portal.${uid}` : "tp.portal");

function normalize(parsed: any): State {
  if (Array.isArray(parsed?.eas)) {
    parsed.eas = parsed.eas.map((e: any) => ({ ...e, symbols: e.symbols ?? [], code: e.code || botCodeFor(e.id) }));
  }
  const merged = { ...initial, ...(parsed ?? {}) } as State;
  // The hidden MT4 engine URL is managed centrally — always use the built-in
  // same-origin bridge served by this app.
  merged.bridgeUrl = resolveBridgeUrl();
  // Main interface skin: only the main interface skins remain (classic v1–v6 retired).
  const splitStyles: Record<string, string> = { m1: "m2", m3: "m4", m5: "m6" };
  merged.homeStyle = splitStyles[merged.homeStyle] ?? merged.homeStyle;
  if (!merged.homeStyle || !MAIN_INTERFACES.some((s) => s.id === merged.homeStyle)) merged.homeStyle = "m2";
  // Retired font choices (display/mono/serif/system) fall back to Default.
  if (!UI_FONTS.some((f) => f.id === merged.uiFont)) merged.uiFont = "default";

  return merged;
}

function load(): State {
  if (typeof window === "undefined") return initial;
  try {
    const raw = localStorage.getItem(scopeKey);
    if (!raw) return normalize(null);
    return normalize(JSON.parse(raw));
  } catch { return { ...initial, bridgeUrl: resolveBridgeUrl() }; }
}

function resolveBridgeUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api/public/bridge`;
  }
  return "/api/public/bridge";
}

let state: State = load();

/** Removes licensed bots whose licence has run out (checked at load and every minute). */
function pruneExpiredBots() {
  const ids = expiredBotIds(state.eas, Date.now());
  for (const id of ids) portalActions.removeEA(id);
}
if (typeof window !== "undefined") {
  setTimeout(pruneExpiredBots, 0);
  setInterval(pruneExpiredBots, 60_000);
}

function persist() {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(scopeKey, JSON.stringify(state)); } catch {}
  }
}

const emit = () => { persist(); listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => state;
/** Current store state outside React. */
export const getPortalState = () => state;

export const usePortalStore = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/** Switch the store to a signed-in account's own bucket (per-account isolation). */
export function setPortalScope(userId: string | null) {
  const next = keyFor(userId);
  if (next === scopeKey) return;
  scopeKey = next;
  state = load();
  listeners.forEach((l) => l());
  pruneExpiredBots();
}

/** Replace local state with the account's cloud-saved workspace. */
export function hydratePortalState(remote: Record<string, unknown> | null) {
  state = normalize(remote);
  emit();
  pruneExpiredBots();
}

/** Serializable snapshot used for cloud sync. */
export function exportPortalState() {
  const { eas, licenses, mentorAccounts, reactivatedEmails, profileImage, themeId, avatarShape, uiFont, activeEAId, homeStyle, bgId, bgAnim } = state;
  return { eas, licenses, mentorAccounts, reactivatedEmails, profileImage, themeId, avatarShape, uiFont, activeEAId, homeStyle, bgId, bgAnim };

}

export function subscribePortal(l: () => void) { return subscribe(l); }

export function applyTheme(themeId: string) {
  if (typeof document === "undefined") return;
  const t = THEMES.find((x) => x.id === themeId) ?? THEMES[0];
  const root = document.documentElement;
  root.style.setProperty("--primary", t.primary);
  root.style.setProperty("--primary-glow", t.glow);
  root.style.setProperty("--accent", t.primary);
  root.style.setProperty("--ring", t.primary);
  root.style.setProperty("--gradient-primary", `linear-gradient(135deg, ${t.primary}, ${t.glow})`);
  root.style.setProperty("--gradient-hero", `radial-gradient(ellipse 70% 60% at 30% 40%, ${t.primary} 35%, transparent 70%)`);
  root.style.setProperty("--shadow-glow", `0 0 80px -10px ${t.primary}`);
}

export function applyUiFont(id: UiFontId) {
  if (typeof document === "undefined") return;
  const f = UI_FONTS.find((x) => x.id === id) ?? UI_FONTS[0];
  document.documentElement.style.setProperty("--font-ui", f.css);
  document.documentElement.style.setProperty("--font-ui-style", f.style);
  document.documentElement.style.setProperty("--font-ui-weight", f.weight);
  document.documentElement.dataset.uiFont = id;
}

export function useApplyTheme() {
  const { themeId, uiFont, avatarShape, homeStyle } = usePortalStore();
  useEffect(() => { applyTheme(themeId); }, [themeId]);
  useEffect(() => { applyUiFont(uiFont); }, [uiFont]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.avatarShape = avatarShape;
    document.documentElement.dataset.homeStyle = homeStyle;
  }, [avatarShape, homeStyle]);
}

export const portalActions = {
  addEA(name: string) {
    if (!canAddMentorBot(state.eas)) return false;
    const id = crypto.randomUUID();
    state = { ...state, eas: [...state.eas, { id, name, code: botCodeFor(id), users: 0, active: 0, image: null, symbols: [] }] };

    emit();
    return true;
  },
  removeEA(id: string) {
    const removed = state.eas.find((e) => e.id === id);
    if (!removed) return;
    const selection = selectionAfterRemoval(state.eas, state.activeEAId, id);
    if (state.activeEAId === id) tradeLog.stop();
    state = {
      ...state,
      eas: state.eas.filter((e) => selection.remaining.some((remaining) => remaining.id === e.id)),
      licenses: state.licenses.filter((l) => l.ea !== removed?.name),
      activeEAId: selection.activeId,
    };
    emit();
  },
  updateEA(id: string, patch: Pick<EA, "name" | "symbols">) {
    const oldName = state.eas.find((e) => e.id === id)?.name;
    state = {
      ...state,
      eas: state.eas.map((e) => e.id === id ? { ...e, ...patch } : e),
      licenses: state.licenses.map((l) => l.ea === oldName ? { ...l, ea: patch.name } : l),
    };
    emit();
  },
  setEAImage(id: string, image: string | null) {
    state = { ...state, eas: state.eas.map((e) => e.id === id ? { ...e, image } : e) };
    emit();
  },
  setEAVideo(id: string, backgroundVideo: string | null) {
    state = { ...state, eas: state.eas.map((e) => e.id === id ? { ...e, backgroundVideo } : e) };
    emit();
  },
  addSymbol(eaId: string, symbol: string) {
    state = { ...state, eas: state.eas.map((e) => e.id === eaId
      ? { ...e, symbols: e.symbols.some((s) => s.symbol.toLowerCase() === symbol.toLowerCase()) ? e.symbols : [...e.symbols, { symbol, lotSize: "0.01", action: "BOTH", platform: "MT4", allowed: false }] }
      : e) };
    emit();
  },
  updateSymbol(eaId: string, symbol: string, patch: Partial<SymbolConfig>) {
    state = { ...state, eas: state.eas.map((e) => e.id === eaId
      ? { ...e, symbols: e.symbols.map((s) => s.symbol === symbol ? { ...s, ...patch } : s) }
      : e) };
    emit();
  },
  toggleSymbolAllowed(eaId: string, symbol: string) {
    state = { ...state, eas: state.eas.map((e) => e.id === eaId
      ? { ...e, symbols: e.symbols.map((s) => s.symbol === symbol ? { ...s, allowed: !s.allowed } : s) }
      : e) };
    emit();
  },
  setProfileImage(image: string | null) {
    state = { ...state, profileImage: image };
    emit();
  },
  setTheme(themeId: string) {
    state = { ...state, themeId };
    applyTheme(themeId);
    emit();
  },
  setBackgroundAnimation(bgAnim: boolean) {
    state = { ...state, bgAnim };
    emit();
  },
  /** Applies a bot config published by the mentor (symbols, artwork, video). */
  applyCloudEA(payload: { id: string; name: string; image?: string | null; backgroundVideo?: string | null; symbols?: SymbolConfig[] }) {
    const idx = state.eas.findIndex((e) => e.id === payload.id || e.code === botCodeFor(payload.id));
    if (idx < 0) return;
    const cur = state.eas[idx];
    const next: EA = {
      ...cur,
      name: payload.name || cur.name,
      image: payload.image ?? cur.image ?? null,
      backgroundVideo: payload.backgroundVideo ?? cur.backgroundVideo ?? null,
      // Keep the user's own lot/trades/direction/platform/allowed choices;
      // the mentor config only decides which symbols exist.
      symbols: payload.symbols
        ? payload.symbols.map((ps) => {
            const mine = cur.symbols.find((s) => s.symbol.toLowerCase() === ps.symbol.toLowerCase());
            return mine ? { ...ps, ...mine } : ps;
          }).concat(cur.symbols.filter((s) => !payload.symbols!.some((ps) => ps.symbol.toLowerCase() === s.symbol.toLowerCase())))
        : cur.symbols,
    };
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    state = { ...state, eas: state.eas.map((e, i) => (i === idx ? next : e)) };
    emit();
  },
  setBackground(bgId: BackgroundId) {
    state = { ...state, bgId };
    emit();
  },
  setHomeStyle(homeStyle: HomeStyleId) {
    state = { ...state, homeStyle };
    emit();
  },
  setAvatarShape(avatarShape: AvatarShape) {
    state = { ...state, avatarShape };
    emit();
  },
  setUiFont(uiFont: UiFontId) {
    state = { ...state, uiFont };
    applyUiFont(uiFont);
    emit();
  },
  setActiveEA(id: string | null) {
    if (state.activeEAId !== id) tradeLog.stop();
    state = { ...state, activeEAId: id };
    emit();
  },
  setBrokerConnected(v: boolean) {
    state = { ...state, brokerConnected: v };
    emit();
  },
  setBridgeUrl(url: string) {
    state = { ...state, bridgeUrl: url.trim() };
    emit();
  },
  setActivatedEmail(email: string | null) {
    state = { ...state, activatedEmail: email ? email.toLowerCase().trim() : null };
    emit();
  },
  setMetaAccount(v: { accountId: string; platform: "mt4" | "mt5"; login: string; broker: string; password: string; server: string } | null) {
    state = v
      ? { ...state, metaAccountId: v.accountId, metaPlatform: v.platform, metaLogin: v.login, metaBroker: v.broker, metaPassword: v.password, metaServer: v.server, brokerConnected: true }
      : { ...state, metaAccountId: null, metaPlatform: null, metaLogin: null, metaBroker: null, metaPassword: null, metaServer: null, brokerConnected: false };
    emit();
  },
  addMentorAccount(mentorId: string, email: string) {
    const account: MentorAccount = {
      id: crypto.randomUUID(), mentorId, email: email.toLowerCase().trim(),
      active: true, createdAt: Date.now(),
    };
    state = { ...state, mentorAccounts: [account, ...state.mentorAccounts] };
    emit();
    return account;
  },
  removeMentorAccount(id: string) {
    state = { ...state, mentorAccounts: state.mentorAccounts.filter((m) => m.id !== id) };
    emit();
  },
  reactivateEmail(email: string) {
    const e = email.toLowerCase().trim();
    state = {
      ...state,
      reactivatedEmails: state.reactivatedEmails.includes(e) ? state.reactivatedEmails : [e, ...state.reactivatedEmails],
      mentorAccounts: state.mentorAccounts.map((m) => m.email === e ? { ...m, active: true } : m),
    };
    emit();
  },
  checkEmailActive(email: string): boolean {
    const e = email.toLowerCase().trim();
    return state.mentorAccounts.some((m) => m.email === e && m.active);
  },
  addLicense(input: { userName: string; ea: string; duration: string }) {
    const key = generateLicenseKey();
    const license: License = {
      id: crypto.randomUUID(), key,
      userName: input.userName, ea: input.ea, duration: input.duration,
      createdAt: Date.now(), active: true,
    };
    state = {
      ...state,
      licenses: [license, ...state.licenses],
      eas: state.eas.map((e) => e.name === input.ea ? { ...e, users: e.users + 1, active: e.active + 1 } : e),
    };
    emit();
    return license;
  },
  validateLicense(rawKey: string): { license: License; ea: EA } | { error: string } {
    const key = rawKey.trim().toUpperCase();
    const license = state.licenses.find((l) => l.key.toUpperCase() === key);
    if (!license) return { error: "Invalid license key" };
    if (!license.active) return { error: "License is inactive" };
    const ea = state.eas.find((e) => e.name === license.ea);
    if (!ea) return { error: "Bot not found for this license" };
    state = { ...state, activeEAId: ea.id };
    emit();
    return { license, ea };
  },
  /** Installs a bot + licence redeemed from the cloud (works on any device / before login). */
  importLicensedEA(ea: { id: string; name: string; image?: string | null; backgroundVideo?: string | null; symbols?: SymbolConfig[] }, license: { key: string; userName: string; duration: string }): EA {
    const existing = state.eas.find((e) => e.id === ea.id || e.name.toLowerCase() === ea.name.toLowerCase());
    // Licence time starts at activation; the mentor's own (unlicensed) bot never gets an end date.
    const expiresAt = licenseExpiresAt(license.duration, Date.now());
    const bot: EA = existing
      ? { ...existing, image: ea.image ?? existing.image, backgroundVideo: ea.backgroundVideo ?? existing.backgroundVideo, symbols: ea.symbols?.length ? ea.symbols : existing.symbols, ...(existing.expiresAt !== undefined ? { expiresAt } : {}) }
      : { id: ea.id, name: ea.name, code: botCodeFor(ea.id), users: 1, active: 1, image: ea.image ?? null, backgroundVideo: ea.backgroundVideo ?? null, symbols: ea.symbols ?? [], expiresAt };
    const entry: License = {
      id: crypto.randomUUID(), key: license.key, userName: license.userName,
      ea: bot.name, duration: license.duration, createdAt: Date.now(), active: true,
    };
    state = {
      ...state,
      eas: existing ? state.eas.map((e) => (e.id === existing.id ? bot : e)) : [...state.eas, bot],
      licenses: state.licenses.some((l) => l.key.toUpperCase() === license.key.toUpperCase())
        ? state.licenses
        : [entry, ...state.licenses],
      activeEAId: bot.id,
    };
    emit();
    return bot;
  },
};


const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function group() {
  let s = "";
  for (let i = 0; i < 3; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}
export function generateLicenseKey() {
  return `${group()}-${group()}-${group()}-${group()}`;
}
