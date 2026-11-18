import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTradeLog, tradeLog, entriesForView, logClock, logTone, type LogView } from "@/lib/trade-log";
import { usePortalStore } from "@/lib/portal-store";
import botLogo from "@/assets/bot-logo.jpg";
import { Button } from "@/components/ui/button";
import { setOverlayProfile, useNativeOverlay } from "@/lib/native-overlay";
import { isTyping, typingHistory, typingStep, visibleText, TYPE_TICK_MS, type TypingState } from "@/lib/typewriter";

/** Draggable floating circle + full-screen status modal. */
export function FloatingLog() {
  const { running, panelOpen, entries } = useTradeLog();
  const { eas, activeEAId, profileImage } = usePortalStore();
  const activeEA = eas.find((e) => e.id === activeEAId) ?? null;
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const bubble = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    if (!running) return;
    const size = bubble.current?.getBoundingClientRect().width ?? 72;
    setPosition({ x: (window.innerWidth - size) / 2, y: (window.innerHeight - size) / 2 });
  }, [running]);
  useEffect(() => {
    const clamp = () => {
      const size = bubble.current?.getBoundingClientRect().width ?? 72;
      setPosition((p) => p ? { x: Math.max(0, Math.min(p.x, window.innerWidth - size)), y: Math.max(0, Math.min(p.y, window.innerHeight - size)) } : p);
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  const avatar = activeEA?.image || profileImage || botLogo;
  const name = activeEA?.name ?? "Algo Vault EA";
  const allowed = (activeEA?.symbols ?? []).filter((s) => s.allowed).map((s) => s.symbol);
  const overlay = useNativeOverlay();
  const allowedKey = allowed.join(",");
  // Android app: this same circle floats over other apps while the bot runs.
  useEffect(() => { setOverlayProfile({ avatarSrc: avatar, name, symbols: allowedKey ? allowedKey.split(",") : [] }); }, [avatar, name, allowedKey]);
  if (overlay.running) return null;
  if (!running && entries.length === 0 && !panelOpen) return null;

  return (
    <>
      <Button
        ref={bubble}
        variant="ghost"
        onClick={() => { if (!suppressClick.current) tradeLog.togglePanel(); suppressClick.current = false; }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
          suppressClick.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const current = drag.current;
          if (!current) return;
          const dx = e.clientX - current.x;
          const dy = e.clientY - current.y;
          if (Math.hypot(dx, dy) > 6) current.moved = true;
          if (!current.moved) return;
          const size = e.currentTarget.getBoundingClientRect().width;
          setPosition({ x: Math.max(0, Math.min(current.left + dx, window.innerWidth - size)), y: Math.max(0, Math.min(current.top + dy, window.innerHeight - size)) });
        }}
        onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null; }}
        onPointerCancel={() => { suppressClick.current = true; drag.current = null; }}
        style={position ? { left: position.x, top: position.y } : undefined}
        className={`floating-bot-circle ${position ? "is-positioned" : ""}`}
        aria-label="Open trade status"
      >
        <img src={avatar} alt="" draggable={false} className="size-full object-cover pointer-events-none" />
        <span className={`floating-bot-indicator ${running ? "is-running" : ""}`} />
      </Button>

      {panelOpen && <LogWindow avatar={avatar} name={name} running={running} entries={entries} />}
    </>
  );
}

/** Floating Trade Log window: avatar on the top edge, status pill, SCRIPT / LIVE views and STOP EA (drag by the top area). */
function LogWindow({ avatar, name, running, entries }: {
  avatar: string; name: string; running: boolean; entries: ReturnType<typeof useTradeLog>["entries"];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<LogView>("script");
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // New lines type out one at a time, in order; lines already in the log show at once.
  const [typing, setTyping] = useState<TypingState>(() => typingHistory(entries));
  const latest = useRef(entries);
  latest.current = entries;
  const typingNow = isTyping(typing, entries);
  useEffect(() => {
    if (!typingNow) return;
    const id = setInterval(() => setTyping((s) => typingStep(s, latest.current)), TYPE_TICK_MS);
    return () => clearInterval(id);
  }, [typingNow]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
  }, [typing, entries, view]);
  useEffect(() => {
    const w = box.current?.offsetWidth ?? 300;
    const h = box.current?.offsetHeight ?? 340;
    setPos({ x: (window.innerWidth - w) / 2, y: Math.max(48, (window.innerHeight - h) / 2) });
  }, []);
  const clamp = (x: number, y: number) => {
    const w = box.current?.offsetWidth ?? 300;
    const h = box.current?.offsetHeight ?? 340;
    return { x: Math.max(0, Math.min(x, window.innerWidth - w)), y: Math.max(40, Math.min(y, window.innerHeight - h)) };
  };
  const shownEntries = entriesForView(entries, view);
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${name} trade log`}
      style={pos ? { left: pos.x, top: pos.y } : { left: "50%", top: "30%", visibility: "hidden" }}
      className="trade-log-window"
    >
      <img src={avatar} alt="" draggable={false} className="trade-log-avatar object-cover" />
      <button type="button" onClick={() => tradeLog.closePanel()} className="trade-log-close" aria-label="Close">
        <X className="size-6" strokeWidth={2.5} />
      </button>
      <div
        className="trade-log-drag"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const element = box.current;
          if (!element) return;
          const r = element.getBoundingClientRect();
          drag.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          setPos(clamp(d.left + e.clientX - d.x, d.top + e.clientY - d.y));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <span className={`trade-log-pill ${running ? "" : "is-off"}`}>{running ? "ACTIVE" : "STOPPED"}</span>
        <p className="trade-log-name">{name}</p>
      </div>
      <div className="trade-log-actions">
        <button type="button" className={`trade-log-action ${view === "script" ? "is-active" : ""}`} aria-pressed={view === "script"} onClick={() => setView("script")}>Script</button>
        <button type="button" className={`trade-log-action ${view === "live" ? "is-active" : ""}`} aria-pressed={view === "live"} onClick={() => setView("live")}>Live</button>
        <button type="button" className="trade-log-action" onClick={() => tradeLog.stop()} disabled={!running}>Stop EA</button>
      </div>
      <div ref={list} className="trade-log-lines" aria-live="polite">
        {shownEntries.length === 0 ? (
          <p className="trade-log-empty">{view === "live" ? "No trades yet" : "Awaiting signal"}<span className="animate-pulse">▌</span></p>
        ) : shownEntries.map((e) => {
          const shown = visibleText(typing, e);
          if (shown === null) return null;
          const tone = logTone(e);
          return (
            <p key={e.id}>
              <span className="trade-log-time">{logClock(e.ts)}</span>
              <span className={`trade-log-text ${tone === "error" ? "is-error" : tone === "pending" ? "is-pending" : ""}`}>
                {shown}{typing.current === e.id && <span className="animate-pulse">▌</span>}
              </span>
            </p>
          );
        })}
      </div>
      <p className="trade-log-status">
        <span className={`trade-log-dot ${running ? "" : "is-off"}`} />
        {running ? "SERVER CONNECTED" : "OFFLINE"}
      </p>
    </div>
  );
}

/** Modal shown when user presses START on the active bot. */
export function StartTradeDialog({
  open, onClose, defaultSymbol, defaultLot, defaultPlatform, onStart,
}: {
  open: boolean; onClose: () => void;
  defaultSymbol: string; defaultLot: string; defaultPlatform: "MT4" | "MT5";
  onStart: (cfg: { lot: string; platform: "MT4" | "MT5"; side: "BUY" | "SELL" | "BOTH"; numTrades: number }) => void;
}) {
  const [lot, setLot] = useState(defaultLot || "0.01");
  const [platform, setPlatform] = useState<"MT4" | "MT5">(defaultPlatform);
  const [side, setSide] = useState<"BUY" | "SELL" | "BOTH">("BUY");
  const [num, setNum] = useState("1");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-5" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border-2 border-primary bg-card p-6 shadow-glow">
        <h2 className="font-display text-xl font-bold text-center">Start Trading</h2>
        <p className="text-center text-xs text-muted-foreground mt-1">Symbol: <span className="text-primary font-bold">{defaultSymbol}</span></p>

        <label className="mt-5 block text-[11px] uppercase tracking-wider text-muted-foreground">Platform</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["MT4", "MT5"] as const).map((p) => (
            <button key={p} onClick={() => setPlatform(p)} className={`h-11 rounded-xl font-bold ${platform === p ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>{p}</button>
          ))}
        </div>

        <label className="mt-4 block text-[11px] uppercase tracking-wider text-muted-foreground">Lot Size</label>
        <input value={lot} onChange={(e) => setLot(e.target.value)} className="mt-1 w-full h-12 rounded-xl bg-background border border-border px-3" />

        <label className="mt-4 block text-[11px] uppercase tracking-wider text-muted-foreground">Direction</label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <button onClick={() => setSide("BUY")} className={`h-11 rounded-xl font-bold ${side === "BUY" ? "bg-green-500 text-white" : "bg-card border border-border"}`}>BUY</button>
          <button onClick={() => setSide("SELL")} className={`h-11 rounded-xl font-bold ${side === "SELL" ? "bg-red-500 text-white" : "bg-card border border-border"}`}>SELL</button>
          <button onClick={() => setSide("BOTH")} className={`h-11 rounded-xl font-bold ${side === "BOTH" ? "bg-gradient-primary text-primary-foreground" : "bg-card border border-border"}`}>BOTH</button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">BOTH follows whichever direction the incoming signal carries.</p>

        <label className="mt-4 block text-[11px] uppercase tracking-wider text-muted-foreground">Number of Trades</label>
        <input value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-1 w-full h-12 rounded-xl bg-background border border-border px-3" />

        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl border border-border font-semibold">Cancel</button>
          <button
            onClick={() => { onStart({ lot, platform, side, numTrades: Math.max(1, Math.min(50, parseInt(num) || 1)) }); onClose(); }}
            className="flex-1 h-12 rounded-xl bg-gradient-primary text-primary-foreground font-bold shadow-glow"
          >Start</button>
        </div>
      </div>
    </div>
  );
}
