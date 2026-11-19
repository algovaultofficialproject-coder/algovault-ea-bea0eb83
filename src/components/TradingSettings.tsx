import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CalendarClock, Check, ChevronDown, ChevronRight, Settings2, Circle, Film, LayoutGrid, LineChart, Palette,
  LockKeyhole, PanelBottom, TrendingUp, RectangleHorizontal, Sparkle, Type, X, MonitorSmartphone, ListChecks, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { smallAccount, useSmallAccount } from "@/lib/small-account-prefs";
import { MAIN_INTERFACES, THEMES, UI_FONTS, portalActions, usePortalStore } from "@/lib/portal-store";
import { CHECKLIST_ITEMS, TEXT_SIZES, profileShapeForInterface, shapesForInterface, tradingPrefs, useTradingPrefs, type BackAnimId, type NavStyle, type PortraitShape } from "@/lib/trading-prefs";

type Props = {
  onClose: () => void;
  colour: string;
  onColour: (idOrHex: string) => void;
  /** The chart scanner rendered inside its settings row (no separate page). */
  scanner: ReactNode;
  /** Open with the chart scanner expanded (e.g. from the Scanner nav button). */
  openScanner?: boolean;
  onFundamentals: () => void;
  hasVideo: boolean;
};

type Section = "interface" | "shape" | "colour" | "font" | "anim" | "nav" | "display" | "checklist" | "scanner" | "small";

const COLOUR_NAMES: Record<string, string> = {
  blue: "Electric Blue", violet: "Royal Purple", green: "Emerald Green", red: "Crimson Red", orange: "Sunset Orange",
  gold: "Solar Gold", pink: "Hot Pink", cyan: "Ice Cyan", teal: "Ocean Teal", lime: "Toxic Lime",
  magenta: "Neon Magenta", sky: "Sky Blue", amber: "Amber Glow", silver: "Chrome Silver",
};
const COLOUR_ORDER = ["blue", "violet", "green", "red", "orange", "gold", "pink", "cyan", "teal", "lime", "magenta", "sky", "amber", "silver"];
const swatchFor = (id: string) => (id === "blue" ? "#0065ff" : THEMES.find((t) => t.id === id)?.swatch ?? "#0065ff");

const SHAPES: Array<{ id: PortraitShape; label: string; sub: string }> = [
  { id: "classic", label: "The Classic", sub: "Circle Shape Interface" },
  { id: "halo", label: "The Halo", sub: "Large Circle With Glow" },
  { id: "widescreen", label: "The Widescreen", sub: "Stretched Rectangle" },
];

const ANIMS: Array<{ id: BackAnimId; emoji: string; label: string; sub: string }> = [
  { id: "profitRain", emoji: "💰", label: "Profit Rain", sub: "Raining symbols" },
  { id: "lightning", emoji: "⚡", label: "Lightning", sub: "Electric storm effect" },
  { id: "colourMatrix", emoji: "🎨", label: "Colour Matrix", sub: "Pulses image, button & name glows on & off" },
  { id: "hackers", emoji: "🧑‍💻", label: "Hackers", sub: "Binary streams flowing behind the UI" },
  { id: "candleChart", emoji: "📈", label: "Candle Chart", sub: "Animated candlestick chart backdrop in accent color" },
  { id: "robotVideo", emoji: "🎞️", label: "Robot Video", sub: "Plays your mentor's robot video behind the app" },
];

const NAVS: Array<{ id: NavStyle; label: string; sub: string }> = [
  { id: "classic", label: "Classic", sub: "MetaTrader · Home · Settings" },
  { id: "updated", label: "Updated", sub: "MetaTrader · Fundamental · Home · Scanner · Settings" },
];

/** Slide-in settings panel for the trading app; every choice is presentation or robot setup, never an order. */
export function TradingSettings({ onClose, colour, onColour, scanner, openScanner, onFundamentals, hasVideo }: Props) {
  const { uiFont, homeStyle } = usePortalStore();
  const shapeLocked = shapesForInterface(homeStyle).length === 1;
  const prefs = useTradingPrefs();
  const sa = useSmallAccount();
  const [open, setOpen] = useState<Section | null>(openScanner ? "scanner" : null);
  const [closing, setClosing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 220);
  };
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`settings-drawer ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-drawer-frame">
        <button type="button" className="settings-drawer-scrim" aria-label="Close settings" onClick={close} />
        <div className="settings-drawer-panel">
          <header className="settings-drawer-head">
            <span className="settings-head-title">
              <span className="settings-head-orb" aria-hidden="true"><Settings2 /></span>
              <span><h2>Settings</h2><p className="settings-head-sub">Style your robot</p></span>
            </span>
            <button ref={closeRef} type="button" className="settings-close" aria-label="Close settings" onClick={close}><X /></button>
          </header>

          <Row icon={<LayoutGrid />} label="Select Main Interface" open={open === "interface"} onClick={() => toggle("interface")}>
            {MAIN_INTERFACES.map((skin) => (
              <OptionCard key={skin.id} selected={homeStyle === skin.id} onClick={() => portalActions.setHomeStyle(skin.id)} className="settings-interface-card">
                <span className="settings-card-copy"><strong>{skin.label}</strong><small>{skin.sub}</small></span>
                {homeStyle === skin.id && <span className="settings-check"><Check /></span>}
              </OptionCard>
            ))}
          </Row>

          <Row icon={<Circle />} label="Select Shape" disabled={shapeLocked} open={!shapeLocked && open === "shape"} onClick={() => toggle("shape")}>
            {SHAPES.filter((s) => shapesForInterface(homeStyle).includes(s.id)).map((s) => (
              <OptionCard key={s.id} selected={profileShapeForInterface(homeStyle, prefs.shape) === s.id} onClick={() => tradingPrefs.setShape(s.id)} className="settings-shape-card">
                <span className={`settings-shape-preview is-${s.id}`} />
                <span className="settings-card-copy"><strong>{s.label}</strong><small>{s.sub}</small></span>
              </OptionCard>
            ))}
          </Row>

          <Row icon={<Palette />} label="Select Colour" open={open === "colour"} onClick={() => toggle("colour")}>
            <ColourWheel colour={colour} onPick={onColour} />
            <div className="settings-colour-grid">
            {COLOUR_ORDER.filter((id) => THEMES.some((t) => t.id === id) || id === "blue").map((id) => (
              <OptionCard key={id} selected={colour === id} onClick={() => onColour(id)} className="settings-colour-card">
                <span className="settings-colour-dot" style={{ backgroundColor: swatchFor(id), "--dot": swatchFor(id) } as CSSProperties} />
                <strong>{COLOUR_NAMES[id]}</strong>
              </OptionCard>
            ))}
            </div>
          </Row>

          <Row icon={<Type />} label="Select Font" open={open === "font"} onClick={() => toggle("font")}>
            {UI_FONTS.map((f) => (
              <OptionCard key={f.id} selected={uiFont === f.id} onClick={() => portalActions.setUiFont(f.id)} className="settings-font-card">
                <span className="settings-font-name" style={{ fontFamily: f.css, fontStyle: f.style, fontWeight: Number(f.weight) }}>{f.label}</span>
                <small>EA Name Font Style</small>
              </OptionCard>
            ))}
          </Row>

          <Row icon={<LineChart />} label="Chart Scanner" open={open === "scanner"} onClick={() => toggle("scanner")}>
            {scanner}
          </Row>

          <Row icon={<Film />} label="Back Animation" open={open === "anim"} onClick={() => toggle("anim")}>
            <ToggleCard emoji="🖼️" label="Bot Image" sub="" on={prefs.botImage} onToggle={() => tradingPrefs.setBotImage(!prefs.botImage)} />
            {ANIMS.map((a) => {
              const locked = a.id === "robotVideo" && !hasVideo;
              return (
                <ToggleCard key={a.id} emoji={a.emoji} label={a.label} sub={locked ? "Ask your mentor to upload a video on their EA to unlock this" : a.sub}
                  on={!locked && prefs.anim[a.id]} disabled={locked} onToggle={() => tradingPrefs.toggleAnim(a.id)} />
              );
            })}
            <ToggleCard emoji="🎙️" label="Bot Voice" sub="Smooth male voice announces start/stop, signals and executed trades" on={prefs.botVoice} onToggle={() => tradingPrefs.setBotVoice(!prefs.botVoice)} />
          </Row>

          <Row icon={<PanelBottom />} label="Bottom Navigator" open={open === "nav"} onClick={() => toggle("nav")}>
            {NAVS.map((n) => (
              <OptionCard key={n.id} selected={prefs.nav === n.id} onClick={() => tradingPrefs.setNav(n.id)} className="settings-radio-card settings-nav-card">
                <span className="settings-card-icon">{n.id === "classic" ? <RectangleHorizontal /> : <Sparkle fill="currentColor" />}</span>
                <span className="settings-card-copy"><strong>{n.label}</strong><small>{n.sub}</small></span>
                <span className={`settings-radio ${prefs.nav === n.id ? "is-on" : ""}`} />
              </OptionCard>
            ))}
          </Row>

          <Row icon={<MonitorSmartphone />} label="Display & Device" open={open === "display"} onClick={() => toggle("display")}>
            <p className="settings-sub-label">Text size</p>
            <div className="settings-pill-group" role="radiogroup" aria-label="Text size">
              {TEXT_SIZES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={prefs.textSize === t.id}
                  className={`settings-pill ${prefs.textSize === t.id ? "is-on" : ""}`} onClick={() => tradingPrefs.setTextSize(t.id)}>
                  <span style={{ fontSize: t.px - 1 }}>Aa</span> {t.label}
                </button>
              ))}
            </div>
            <ToggleCard emoji="🔆" label="Keep Screen Awake" sub="Stops the phone screen sleeping while the app is open" on={prefs.keepAwake} onToggle={() => tradingPrefs.setKeepAwake(!prefs.keepAwake)} />
          </Row>

          <Row icon={<ListChecks />} label="Pre-Trade Checklist" open={open === "checklist"} onClick={() => toggle("checklist")}>
            {(() => {
              const done = prefs.checklist.filter(Boolean).length;
              const all = done === CHECKLIST_ITEMS.length;
              return (
                <div className={`settings-check-progress ${all ? "is-ready" : ""}`}>
                  <span>{all ? "✅ Ready to trade" : `${done} of ${CHECKLIST_ITEMS.length} checked`}</span>
                  <span className="settings-check-bar"><span style={{ width: `${(done / CHECKLIST_ITEMS.length) * 100}%` }} /></span>
                </div>
              );
            })()}
            {CHECKLIST_ITEMS.map((c, i) => (
              <ToggleCard key={c.label} emoji={c.emoji} label={c.label} sub={c.sub} on={prefs.checklist[i]} onToggle={() => tradingPrefs.toggleCheck(i)} />
            ))}
            <button type="button" className="settings-pill settings-reset" onClick={() => tradingPrefs.resetChecklist()}><RotateCcw className="size-4" /> Reset for next trade</button>
          </Row>

          <Row icon={<TrendingUp />} label="Loss limit" open={open === "small"} onClick={() => toggle("small")}>
            <SmallAccountPanel sa={sa} />
          </Row>

          <Row icon={<CalendarClock />} label="Fundamentals" chevron onClick={() => { close(); onFundamentals(); }} />
        </div>
      </div>
    </div>
  );
}

function SmallAccountPanel({ sa }: { sa: ReturnType<typeof useSmallAccount> }) {
  const sym = sa.currency === "ZAR" ? "R" : "$";
  return (
    <>
      <ToggleCard emoji="🛡️" label="Loss limit per signal" sub={`All trades of one signal together lose at most ${sym}${sa.maxLoss || "0"} if the stop is hit — the robot lowers the lot or waits`} on={sa.lossCap} onToggle={() => smallAccount.set({ lossCap: !sa.lossCap })} />
      {sa.lossCap && <Input inputMode="decimal" aria-label="Maximum loss per signal" value={sa.maxLoss} onChange={(e) => smallAccount.set({ maxLoss: e.target.value.replace(/[^0-9.]/g, "") })} />}
      <p className="settings-sub-label">Account currency</p>
      <div className="settings-pill-group" role="radiogroup" aria-label="Currency">
        {(["ZAR", "USD"] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={sa.currency === c} className={`settings-pill ${sa.currency === c ? "is-on" : ""}`} onClick={() => smallAccount.set({ currency: c })}>{c === "ZAR" ? "R" : "$"}</button>
        ))}
      </div>
      <ToggleCard emoji="🪙" label="Cent account" sub="Turn on if your broker account is a cent account (best for balances under R1 000)" on={sa.cent} onToggle={() => smallAccount.set({ cent: !sa.cent })} />
    </>
  );
}

function Row({ icon, label, open, chevron, disabled, onClick, children }: { icon: ReactNode; label: string; open?: boolean; chevron?: boolean; disabled?: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <div className="settings-section">
      <Button type="button" variant="ghost" disabled={disabled} className={`settings-row ${open ? "is-open" : ""}`} aria-expanded={chevron ? undefined : open} onClick={onClick}>
        <span className="settings-row-icon">{icon}</span>
        <span className="settings-row-label">{label}</span>
        <span className="settings-row-end" aria-hidden="true">{disabled ? <LockKeyhole /> : chevron ? <ChevronRight /> : <ChevronDown />}</span>
      </Button>
      {open && children && <div className="settings-section-body">{children}</div>}
    </div>
  );
}

function OptionCard({ selected, onClick, className, children }: { selected: boolean; onClick: () => void; className?: string; children: ReactNode }) {
  return <button type="button" className={`settings-card ${className ?? ""} ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={onClick}>{children}</button>;
}

function ToggleCard({ emoji, label, sub, on, disabled, onToggle }: { emoji: string; label: string; sub: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`settings-card settings-toggle-card ${on ? "is-on" : ""}`} onClick={onToggle}>
      <span className="settings-emoji" aria-hidden="true">{emoji}</span>
      <span className="settings-card-copy"><strong>{label}</strong><small>{sub}</small></span>
      <span className="settings-switch"><span /></span>
    </button>
  );
}

/* ---------- colour wheel ---------- */
function hueToHex(h: number) {
  const s = 1, l = 0.45;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hexToHue(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 215;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function ColourWheel({ colour, onPick }: { colour: string; onPick: (hex: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  const propHex = colour.startsWith("#") ? colour : swatchFor(colour);
  const [hue, setHue] = useState(() => hexToHue(propHex));
  const [isDragging, setIsDragging] = useState(false);
  const turn = useRef(hexToHue(propHex));
  // Follow outside colour changes (e.g. tapping a preset) when the user is not turning the wheel.
  useEffect(() => { if (!dragging.current) setHue(hexToHue(propHex)); }, [propHex]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  // Recolour the app at most once per screen frame so the knob never stutters.
  const schedule = (hex: string) => {
    pending.current = hex;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current) onPick(pending.current);
      pending.current = null;
    });
  };
  const flush = () => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (pending.current) { onPick(pending.current); pending.current = null; }
  };
  const hueAt = (x: number, y: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    const angle = Math.atan2(x - (box.left + box.width / 2), -(y - (box.top + box.height / 2)));
    return ((angle * 180) / Math.PI + 360) % 360;
  };
  const pickAt = (x: number, y: number) => {
    const h = hueAt(x, y);
    if (h === null) return;
    setHue(h);
    schedule(hueToHex(h));
  };
  const stop = () => { dragging.current = false; setIsDragging(false); flush(); };
  const step = (delta: number) => { const h = (hue + delta + 360) % 360; setHue(h); onPick(hueToHex(h)); };
  const live = hueToHex(hue);
  // Keep a running angle so the knob glides around the ring by the shortest way (never jumps across 0°/360°).
  turn.current += ((hue - turn.current) % 360 + 540) % 360 - 180;
  const arm: CSSProperties = { transform: `rotate(${turn.current}deg)` };
  return (
    <div className="settings-wheel-card">
      <div
        ref={ref}
        className={`settings-wheel ${isDragging ? "is-dragging" : ""}`}
        role="slider"
        aria-label="Colour wheel"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hue)}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") step(5); if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(-5); }}
        onPointerDown={(e) => { e.preventDefault(); dragging.current = true; setIsDragging(true); e.currentTarget.setPointerCapture(e.pointerId); pickAt(e.clientX, e.clientY); }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
          const last = events.length ? events[events.length - 1] : e.nativeEvent;
          pickAt(last.clientX, last.clientY);
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={() => { if (dragging.current) stop(); }}
      >
        <span className="settings-wheel-hole" />
        <span className="settings-wheel-core" style={{ backgroundColor: live }} />
        <span className="settings-wheel-arm" style={arm}><span className="settings-wheel-knob" /></span>
      </div>
    </div>
  );
}
