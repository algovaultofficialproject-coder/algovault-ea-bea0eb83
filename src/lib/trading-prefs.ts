import { useSyncExternalStore } from "react";
import { COPY_INTERFACE_IDS, EXTRA_INTERFACE_IDS, FIXED_SHAPE_INTERFACE_IDS } from "./interface-ids";

/** Presentation-only preferences of the trading app, stored on this device. */
export type PortraitShape = "classic" | "halo" | "widescreen";

/** Resolve presentation without overwriting the shape saved for other interfaces. */
/** Shapes a home design may use; Crimson is classic only and the extra designs cannot use The Halo. */
export function shapesForInterface(interfaceId: string): PortraitShape[] {
  if (interfaceId === "m7" || FIXED_SHAPE_INTERFACE_IDS.includes(interfaceId)) return ["classic"];
  if (EXTRA_INTERFACE_IDS.includes(interfaceId) || COPY_INTERFACE_IDS.includes(interfaceId)) return ["classic", "widescreen"];
  return ["classic", "halo", "widescreen"];
}

export function profileShapeForInterface(interfaceId: string, savedShape: PortraitShape): PortraitShape {
  return shapesForInterface(interfaceId).includes(savedShape) ? savedShape : "classic";
}

export type NavStyle = "classic" | "updated";
export type BackAnimId = "profitRain" | "lightning" | "colourMatrix" | "hackers" | "candleChart" | "robotVideo";

export type TextSize = "small" | "normal" | "large";
export const TEXT_SIZES: Array<{ id: TextSize; label: string; px: number }> = [
  { id: "small", label: "Small", px: 14 },
  { id: "normal", label: "Normal", px: 16 },
  { id: "large", label: "Large", px: 18 },
];
/** Root font size for the trading app; unknown values fall back to Normal (16px). */
export const textSizePx = (size: string) => TEXT_SIZES.find((t) => t.id === size)?.px ?? 16;

export const CHECKLIST_ITEMS = [
  { emoji: "📰", label: "Checked the news", sub: "No big news event in the next hour" },
  { emoji: "🕒", label: "Good session", sub: "London or New York is open" },
  { emoji: "🛑", label: "Stop loss set", sub: "I know where I'm wrong" },
  { emoji: "⚖️", label: "Lot size checked", sub: "Risk is 1–2% of my balance" },
  { emoji: "🧘", label: "Calm mind", sub: "Not chasing losses or trading angry" },
] as const;

/** Ticks always match the checklist length; anything not explicitly true is unticked. */
export function normalizeChecklist(raw: unknown): boolean[] {
  const arr = Array.isArray(raw) ? raw : [];
  return CHECKLIST_ITEMS.map((_, i) => arr[i] === true);
}

export interface TradingPrefs {
  textSize: TextSize;
  keepAwake: boolean;
  checklist: boolean[];
  shape: PortraitShape;
  nav: NavStyle;
  anim: Record<BackAnimId, boolean>;
  botImage: boolean;
  botVoice: boolean;
}

const KEY = "algo:trading-prefs";
const DEFAULTS: TradingPrefs = {
  textSize: "normal",
  keepAwake: false,
  checklist: CHECKLIST_ITEMS.map(() => false),
  shape: "classic",
  nav: "classic",
  anim: { profitRain: false, lightning: false, colourMatrix: false, hackers: false, candleChart: false, robotVideo: false },
  botImage: true,
  botVoice: true,
};

function normalize(raw: unknown): TradingPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<TradingPrefs>;
  const anim = { ...DEFAULTS.anim };
  for (const k of Object.keys(anim) as BackAnimId[]) if (typeof r.anim?.[k] === "boolean") anim[k] = r.anim[k];
  return {
    textSize: r.textSize === "small" || r.textSize === "large" ? r.textSize : "normal",
    keepAwake: r.keepAwake === true,
    checklist: normalizeChecklist(r.checklist),
    shape: r.shape === "halo" || r.shape === "widescreen" ? r.shape : "classic",
    nav: r.nav === "updated" ? "updated" : "classic",
    anim,
    botImage: typeof r.botImage === "boolean" ? r.botImage : true,
    botVoice: typeof r.botVoice === "boolean" ? r.botVoice : true,
  };
}

let state: TradingPrefs = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { state = normalize(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { state = normalize(null); }
}

const subscribe = (l: () => void) => { ensureLoaded(); listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;
const getServerSnapshot = () => DEFAULTS;

export const useTradingPrefs = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

function set(patch: Partial<TradingPrefs>) {
  ensureLoaded();
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export const tradingPrefs = {
  get: () => { ensureLoaded(); return state; },
  setShape: (shape: PortraitShape) => set({ shape }),
  setNav: (nav: NavStyle) => set({ nav }),
  toggleAnim: (id: BackAnimId) => set({ anim: { ...state.anim, [id]: !state.anim[id] } }),
  setBotImage: (botImage: boolean) => set({ botImage }),
  setBotVoice: (botVoice: boolean) => set({ botVoice }),
  setTextSize: (textSize: TextSize) => set({ textSize }),
  setKeepAwake: (keepAwake: boolean) => set({ keepAwake }),
  toggleCheck: (i: number) => set({ checklist: state.checklist.map((v, j) => (j === i ? !v : v)) }),
  resetChecklist: () => set({ checklist: CHECKLIST_ITEMS.map(() => false) }),
};
