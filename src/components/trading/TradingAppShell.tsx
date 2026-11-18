import "@fontsource/rubik-glitch/400.css";
import { Link, useSearch } from "@tanstack/react-router";
import { useAutoScalp } from "@/lib/useAutoScalp";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type CSSProperties } from "react";
import {
  Plus, Scan,
  ArrowLeft, Play, Pause,
  Palette, LayoutGrid, Check, Trash2, ArrowRight, Upload, Loader2, Zap, Radio,
  Sun, Smartphone, Apple, Bell, Globe, Plug, MessageCircle,
  BarChart3, Info, X, Clock, TrendingUp, Activity, CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActivateRobotDialog } from "@/components/ActivateRobotDialog";
import { FloatingLog } from "@/components/TradeLog";
import { OverlayPermissionGate } from "@/components/OverlayPermissionGate";
import { appEntryStep, useNativeOverlay } from "@/lib/native-overlay";
import { tradeLog, useTradeLog } from "@/lib/trade-log";
import { consumeAppAccess } from "@/lib/app-access.functions";
import { mustSignOut, signOutRound } from "@/lib/app-access";
import { saveAppSession, useAppSessionGuard } from "@/lib/app-session";
import { FundamentalsPanel, useWarmCalendar } from "@/components/trading/FundamentalsPanel";
import { getPaymentNumber } from "@/lib/payment-number.functions";
import { usePortalStore, portalActions, exportPortalState, THEMES, MAIN_INTERFACES, BACKGROUNDS, UI_FONTS, type SymbolConfig, type UiFontId } from "@/lib/portal-store";
import { MainInterfaceHome } from "@/components/MainInterfaceHome";
import { TradingSettings } from "@/components/TradingSettings";
import { BackAnimations } from "@/components/BackAnimations";
import { NavHomeIcon, NavChartIcon, NavWaveIcon, NavGearIcon, NavCalendarIcon } from "@/components/NavIcons";
import { profileShapeForInterface, tradingPrefs, useTradingPrefs } from "@/lib/trading-prefs";
import { useBotVoice } from "@/hooks/use-bot-voice";
import { useDoubleTap } from "@/hooks/use-double-tap";
import { useKeepAwake, useTextSize } from "@/hooks/use-trading-device";
import { getSmartSignal } from '@/lib/smart-signal.functions';
import { getCandles } from "@/lib/market-data.functions";
import { chartWithPro, proToChart, scanProSignal, type CandlesFn } from "@/lib/autotrader-pro/pro-signal";
import { useTurboSignals } from "@/lib/useTurboSignals";
import { fetchEAConfig } from "@/lib/ea-config.functions";
import { connectBrokerAccount, executeTrade, disconnectBrokerAccount } from "@/lib/metaapi.functions";
import { usePositionGuard } from "@/lib/usePositionGuard";
import { OpenTradesList } from "@/components/trading/OpenTradesList";
import { TradingTools } from "@/components/trading/TradingTools";
import { ChartScanner } from "@/components/trading/ChartScanner";
import { testCustomBroker, executeCustomBrokerOrder } from "@/lib/custom-broker.functions";
import { supabase } from "@/integrations/supabase/client";
import botLogo from "@/assets/bot-logo.jpg";

type Tab = "home" | "meta" | "news";

/** The trading app, shared by /ios (web) and /android (Android app). */
export function AppShell() {
  const { activatedEmail, eas } = usePortalStore();
  const overlay = useNativeOverlay();
  const [mounted, setMounted] = useState(false);
  useAppSessionGuard(mounted ? activatedEmail : null);
  useEffect(() => {
    // Emails that lost automatic access are signed out once so they must reactivate.
    const current = activatedEmail;
    if (current && mustSignOut(current, localStorage.getItem("algo:signout-round"))) {
      localStorage.setItem("algo:signout-round", signOutRound(current) ?? "");
      portalActions.setActivatedEmail(null);
    }
    setMounted(true);
    document.documentElement.classList.add("light");
  }, []);
  // Avoid SSR/CSR mismatch: server renders neutral shell; client renders the real gate/app after mount.
  if (!mounted) return <AppSplash />;
  // Android app: "Display over other apps" must be allowed before anything else, including sign-in.
  const step = appEntryStep({ checked: overlay.checked, native: overlay.native, permission: overlay.permission, signedIn: !!activatedEmail });
  if (step === "loading") return <AppSplash />;
  if (step === "overlay") return <OverlayPermissionGate />;
  if (step === "signin") return <EmailGate />;
  // No bot yet — a licence key is required before the app can be used.
  if (eas.length === 0) return <ActivateRobotDialog open required onClose={() => {}} />;
  return <AppInner />;
}

/** Shown for the first instant while the app opens, so the screen is never blank. */
function AppSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <img src={botLogo} alt="Algo Vault EA" className="size-16 rounded-2xl object-cover" />
      <p className="text-sm font-semibold text-foreground">Algo Vault EA</p>
    </div>
  );
}

/* ---------------- Email/activation gate (DB-backed, no portal login needed) ---------------- */
function EmailGate() {
  const consumeAccess = useServerFn(consumeAppAccess);
  const loadNumber = useServerFn(getPaymentNumber);
  const search = useSearch({ strict: false }) as { email?: string; mentorId?: string };
  const [email, setEmail] = useState(search.email ?? "");
  const [mentorId, setMentorId] = useState(search.mentorId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [needsActivation, setNeedsActivation] = useState(false);
  const [waNumber, setWaNumber] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadNumber().then((r) => setWaNumber(r.number)).catch(() => {}); }, [loadNumber]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNeedsActivation(false);
    setBusy(true);
    const e2 = email.trim().toLowerCase();
    if (!mentorId.trim()) { setErr("Enter your mentor ID"); setBusy(false); return; }
    if (!e2) { setErr("Enter your email"); setBusy(false); return; }
    let res: { ok: boolean; error?: string; code?: "contact_admin" | "unavailable"; session?: string; until?: string | null };
    try {
      res = await consumeAccess({ data: { email: e2 } });
    } catch {
      res = { ok: false, code: "unavailable" as const, error: "Could not verify this email right now. Try again." };
    }
    setBusy(false);
    if (!res.ok) {
      // Nothing was activated for this email — the way in is the admin on
      // WhatsApp, so show the contact button instead of leaving them stuck.
      setNeedsActivation(res.code === "contact_admin");
      setErr(res.error ?? "Account still pending — ask the admin to reactivate this email.");
      return;
    }
    // Always start fresh — no auto-EA across logins
    if (res.session) saveAppSession(res.session, res.until ?? null);
    portalActions.setActiveEA(null);
    portalActions.setActivatedEmail(e2);
  }

  return (
    <div className="app-access min-h-screen bg-background text-foreground flex flex-col items-center px-5 pt-10 pb-10 sm:pt-14">
      <div className="access-logo size-36 sm:size-44 rounded-[36px] bg-card overflow-hidden"><img src={botLogo} alt="AlgoVault robot" className="size-full object-cover" /></div>
      <h1 className="mt-8 font-display text-4xl sm:text-5xl font-bold">AlgoVault</h1>
      <p className="text-muted-foreground mt-5 text-center text-base">Enter your details to get started</p>

      <form onSubmit={check} className="access-form mt-9 w-full max-w-sm rounded-[28px] bg-card px-6 py-7 sm:px-7 sm:py-8 space-y-5">
        <div><label htmlFor="app-mentor-id" className="text-sm font-bold text-muted-foreground">MENTOR ID</label><Input id="app-mentor-id" required value={mentorId} onChange={(e) => setMentorId(e.target.value)} placeholder="Mentor ID" autoComplete="off" className="mt-3 h-16 rounded-2xl bg-input px-5 text-base" /></div>
        <div><label htmlFor="app-email" className="text-sm font-bold text-muted-foreground">EMAIL</label>
        <Input
          id="app-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          type="email"
          required
          autoComplete="email"
          className="mt-3 h-16 rounded-2xl bg-input px-5 text-base"
        /></div>
        {err && <p role="alert" className="text-sm text-destructive text-center">{err}</p>}
        {needsActivation && waNumber && (
          <Button asChild variant="outline" className="w-full h-14 rounded-full font-bold text-base">
            <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer">
              <MessageCircle className="size-5" />Contact admin on WhatsApp
            </a>
          </Button>
        )}
        <Button
          type="submit"
          disabled={busy}
          className="access-button w-full h-16 rounded-full font-bold text-base"
        >
          {busy ? "Checking…" : "Access AlgoVault"}
        </Button>
      </form>
    </div>
  );
}

/* ---------------- Main app shell ---------------- */
function AppInner() {
  const { eas, activeEAId, metaLogin, metaPassword, metaServer, bgId, bgAnim, homeStyle } = usePortalStore();
  const activeEA = eas.find((e) => e.id === activeEAId) || null;
  const { running, runningEAId } = useTradeLog();
  const [pairsForEA, setPairsForEA] = useState<string | null>(null);
  const executionEnabled = running && runningEAId === activeEAId && !pairsForEA;
  useEffect(() => {
    if (pairsForEA && !eas.some((ea) => ea.id === pairsForEA)) setPairsForEA(null);
  }, [eas, pairsForEA]);
  // Signals only execute while the bot is switched ON, and only signals sent
  // after it was switched on — nothing is replayed later.
  const [startedAt, setStartedAt] = useState<string | null>(null);
  useEffect(() => { setStartedAt(running ? new Date().toISOString() : null); }, [running]);
  const prefs = useTradingPrefs();
  useWarmCalendar();
  useBotVoice(prefs.botVoice);
  useTextSize(prefs.textSize);
  useKeepAwake(prefs.keepAwake);
  useTurboSignals({
    eaId: activeEA?.id ?? null,
    eaName: activeEA?.name ?? null,
    login: metaLogin, password: metaPassword, server: metaServer,
    enabled: executionEnabled,
    since: startedAt,
  });
  useAutoScalp({
    eaId: activeEA?.id ?? null,
    eaName: activeEA?.name ?? null,
    login: metaLogin, password: metaPassword, server: metaServer,
    enabled: executionEnabled,
  });
  // Runs whenever an account is connected (also while the robot holds after a trade).
  usePositionGuard(running);

  // Live mentor sync — symbols and profile artwork the mentor changes
  // flow down to this bot automatically.
  const pullConfig = useServerFn(fetchEAConfig);
  const code = activeEA?.code ?? null;
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const tick = async () => {
      try {
        const cfg = await pullConfig({ data: { code } });
        if (alive && cfg) portalActions.applyCloudEA(cfg);
      } catch { /* offline — keep local config */ }
    };
    void tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [code, pullConfig]);
  const [tab, setTab] = useState<Tab>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [colour, setColour] = useState("blue");
  const [glass, setGlass] = useState<"neon" | "sections">("neon");
  const isHex = (v: string | null): v is string => !!v && /^#[0-9a-f]{6}$/i.test(v);
  useEffect(() => {
    const saved = localStorage.getItem("algo:trading-colour");
    if (THEMES.some((theme) => theme.id === saved) || isHex(saved)) setColour(saved ?? "blue");
    if (localStorage.getItem("algo:trading-glass") === "sections") setGlass("sections");
  }, []);
  const chooseColour = (id: string) => {
    if (!THEMES.some((theme) => theme.id === id) && !isHex(id)) return;
    setColour(id);
    localStorage.setItem("algo:trading-colour", id);
  };
  const cycleColour = () => {
    const next = THEMES[(Math.max(-1, THEMES.findIndex((theme) => theme.id === colour)) + 1) % THEMES.length];
    if (!next) return;
    chooseColour(next.id);
  };
  const bgImage = activeEA?.image || botLogo;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = () => { setPairsForEA(null); setScannerOpen(true); setSettingsOpen(true); };
    const c = () => { setSettingsOpen(false); setTab("home"); setPairsForEA(null); };
    window.addEventListener("algo:open-scanner", h);
    window.addEventListener("algo:close-settings", c);
    return () => {
      window.removeEventListener("algo:open-scanner", h);
      window.removeEventListener("algo:close-settings", c);
    };
  }, []);

  return (
    <div
      className={`app-ui-font reference-trading-app min-h-screen bg-background relative overflow-hidden ${tab === "home" && !pairsForEA ? "reference-home-active" : ""}`}
      data-interface={homeStyle} data-trading-colour={isHex(colour) ? "custom" : colour} data-glass={glass} data-view={tab}
      data-portrait-shape={profileShapeForInterface(homeStyle, prefs.shape)} data-nav-style={prefs.nav} data-colour-matrix={prefs.anim.colourMatrix ? "on" : undefined}
      style={isHex(colour) ? ({ "--primary": colour, "--primary-glow": colour, "--border": colour } as CSSProperties) : undefined}
    >
      {(prefs.botImage || (prefs.anim.robotVideo && activeEA?.backgroundVideo)) && <div className="reference-bot-backdrop fixed inset-0 pointer-events-none z-0">
        {prefs.anim.robotVideo && activeEA?.backgroundVideo
          ? <video key={activeEA.backgroundVideo} src={activeEA.backgroundVideo} poster={bgImage} autoPlay muted loop playsInline className="bot-photo-background w-full h-full object-cover" />
          : prefs.botImage ? <img src={bgImage} alt="" className="bot-photo-background w-full h-full object-cover" /> : null}
        <div className="absolute inset-0 bg-background/35" />
      </div>}
      <BackAnimations anim={prefs.anim} />

      <div className={`relative z-10 max-w-[480px] mx-auto min-h-screen ${tab === "home" && !pairsForEA ? "reference-home-scroll" : "pb-24"}`}
>
        {pairsForEA ? (
          <PairsView eaId={pairsForEA} onBack={() => setPairsForEA(null)} />
        ) : (
          <>
            {tab === "home" && <HomeTab onOpenPairs={(id) => { tradeLog.stop(); setPairsForEA(id); }} activeEA={activeEA} onCycleColour={cycleColour} />}
            {tab === "meta" && <MetaTraderTab />}
            {tab === "news" && <FundamentalsPanel />}
          </>
        )}
      </div>

      <nav aria-label="Trading navigation" className="reference-nav slim-nav fixed bottom-0 z-30" data-nav-style={prefs.nav}>
        <div className="max-w-[480px] mx-auto flex items-end justify-around">
          <TabItem icon={NavChartIcon} label="Metatrader" active={tab === "meta" && !settingsOpen} onClick={() => { setTab("meta"); setPairsForEA(null); }} />
          {prefs.nav === "updated" && <TabItem icon={NavCalendarIcon} label="Fundamental" active={tab === "news" && !settingsOpen} onClick={() => { setTab("news"); setPairsForEA(null); }} />}
          <TabItem icon={NavHomeIcon} label="Home" big active={tab === "home" && !pairsForEA && !settingsOpen} onClick={() => { setTab("home"); setPairsForEA(null); }} onDoubleTap={() => {
            const next = MAIN_INTERFACES[(MAIN_INTERFACES.findIndex((skin) => skin.id === homeStyle) + 1) % MAIN_INTERFACES.length];
            if (next) portalActions.setHomeStyle(next.id);
          }} />
          {prefs.nav === "updated" && <TabItem icon={NavWaveIcon} label="Scanner" active={settingsOpen && scannerOpen} onClick={() => { setPairsForEA(null); setScannerOpen(true); setSettingsOpen(true); }} />}
          <TabItem icon={NavGearIcon} label="Settings" active={settingsOpen && !scannerOpen} onClick={() => { setScannerOpen(false); setSettingsOpen(true); }} />
        </div>
      </nav>
      {settingsOpen && (
        <TradingSettings
          onClose={() => { setSettingsOpen(false); setScannerOpen(false); }}
          colour={colour}
          onColour={chooseColour}
          scanner={<ChartScanner activeEA={activeEA} />}
          openScanner={scannerOpen}
          onFundamentals={() => { setSettingsOpen(false); setScannerOpen(false); setPairsForEA(null); setTab("news"); }}
          hasVideo={Boolean(activeEA?.backgroundVideo)}
        />
      )}
      <FloatingLog />
    </div>
  );
}

function TabItem({ icon: Icon, label, active, big, onClick, onDoubleTap }: { icon: React.ComponentType<{ className?: string; fill?: string }>; label: string; active?: boolean; big?: boolean; onClick?: () => void; onDoubleTap?: () => void }) {
  const tap = useDoubleTap(() => onDoubleTap?.(), onClick);
  return <Button variant="ghost" onClick={tap} className={`reference-tab ${big ? "reference-home-tab" : ""} ${active ? "is-active" : ""}`}><span className="reference-tab-icon"><Icon /></span><span>{label}</span></Button>;
}

/* ---------------- Home ---------------- */
function HomeTab({ activeEA, onOpenPairs, onCycleColour }: { activeEA: ReturnType<typeof usePortalStore>["eas"][number] | null; onOpenPairs: (id: string) => void; onCycleColour: () => void }) {
  const [authOpen, setAuthOpen] = useState(false);
  const { eas, profileImage, homeStyle } = usePortalStore();
  const { running } = useTradeLog();


  const openScanner = () => window.dispatchEvent(new Event("algo:open-scanner"));

  function toggleStart() {
    if (!activeEA) return;
    if (running) { tradeLog.stop(); return; }
    tradeLog.start(activeEA.id);
    tradeLog.engineOn();
  }


  if (!activeEA) {
    return <EmptyHome variant={homeStyle} onAdd={() => setAuthOpen(true)} authOpen={authOpen} closeAuth={() => setAuthOpen(false)} />;
  }

  const initials = activeEA.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const avatar = activeEA.image || profileImage || botLogo;

  const props: HomeVariantProps = {
    activeEA, eas, profileImage, avatar, initials, running,
    onOpenPairs, openScanner, toggleStart,
    onRemove: () => { if (confirm(`Remove ${activeEA.name}?`)) portalActions.removeEA(activeEA.id); },
    onPickEA: (id: string) => portalActions.setActiveEA(id),
    onAdd: () => setAuthOpen(true),
  };

  return (
    <div data-home-style={homeStyle} className="home-shell">
      <MainInterfaceHome skinId={homeStyle} {...props} onCycleColour={onCycleColour} onOpenLogs={() => tradeLog.togglePanel()} onRemoveEA={(id) => { const ea = eas.find((bot) => bot.id === id); if (ea && confirm(`Remove ${ea.name}?`)) portalActions.removeEA(id); }} />
      <ActivateRobotDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

type HomeVariantProps = {
  activeEA: NonNullable<ReturnType<typeof usePortalStore>["eas"][number]>;
  eas: ReturnType<typeof usePortalStore>["eas"];
  profileImage: string | null;
  avatar: string;
  initials: string;
  running: boolean;
  onOpenPairs: (id: string) => void;
  openScanner: () => void;
  toggleStart: () => void;
  onRemove: () => void;
  onPickEA: (id: string) => void;
  onAdd: () => void;
};

function EmptyHome({ onAdd, authOpen, closeAuth }: { variant: string; onAdd: () => void; authOpen: boolean; closeAuth: () => void }) {
  return <><Button variant="ghost" className="reference-add" onClick={onAdd}><Plus /> Add License Key</Button><ActivateRobotDialog open={authOpen} onClose={closeAuth} /></>;
}

/* ---------------- Live signals from EA bridge ---------------- */
type SignalRow = {
  id: string; symbol: string; action: string;
  entry_price: number | null; stop_loss: number | null; take_profit: number | null;
  lot_size: number | null; status: string; broker: string | null; account_number: string | null;
  created_at: string;
};
function LiveSignals() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from("signals").select("*").order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => { if (active && data) setSignals(data as SignalRow[]); });
    const ch = supabase.channel("signals-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, (payload) => {
        const row = payload.new as SignalRow & { source?: string };
        setSignals((prev) => [row, ...prev].slice(0, 30));
        // Only manual mentor broadcasts or MT4 bridge trades are allowed to
        // write into the floating trading log.
        const src = (row.broker || (row as any).source || "").toLowerCase();
        const allowed = !src || src.includes("manual") || src.includes("mt4") || src.includes("desktop");
        if (allowed) {
          tradeLog.signal({
            side: row.action, symbol: row.symbol,
            sl: row.stop_loss ?? "auto",
            tp: row.take_profit ?? "auto",
          });
        }
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  async function close(_id: string, _sig: SignalRow) {
    // silent close request — log only writes on real signal ingress
  }



  return (
    <section className="mt-6 px-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs tracking-[0.3em] uppercase text-muted-foreground flex items-center gap-2">
          <Radio className={`size-3 ${connected ? "text-green-400 animate-pulse" : "text-muted-foreground"}`} /> Live Signals
        </h2>
        <span className="text-[10px] text-muted-foreground">{connected ? "Streaming" : "Offline"}</span>
      </div>
      {signals.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground py-6 rounded-2xl border border-dashed border-border">
          Waiting for signals from your EA bridge…
        </p>
      ) : (
        <div className="space-y-2">
          {signals.map((s) => (
            <div key={s.id} className="rounded-2xl border border-border bg-card/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.action === "BUY" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{s.action}</span>
                  <span className="font-mono font-bold">{s.symbol}</span>
                  <span className="text-[10px] text-muted-foreground">{s.lot_size ?? "—"} lots</span>
                </div>
                <button onClick={() => close(s.id, s)} className="text-[10px] text-primary font-semibold">CLOSE</button>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] font-mono text-muted-foreground">
                <span>E {s.entry_price ?? "—"}</span>
                <span className="text-red-400">SL {s.stop_loss ?? "—"}</span>
                <span className="text-green-400">TP {s.take_profit ?? "—"}</span>
              </div>
              {s.account_number && <p className="mt-1 text-[10px] text-muted-foreground">{s.broker} · {s.account_number}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Pairs ---------------- */
const pill = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider";
const pillOn = "border-primary bg-primary text-primary-foreground shadow-[0_0_14px_-4px_var(--primary)]";
const pillOff = "border-border bg-card text-foreground/80";

function PairsView({ eaId, onBack }: { eaId: string; onBack: () => void }) {
  const { eas, profileImage } = usePortalStore();
  const avatar = profileImage || botLogo;
  const ea = eas.find((e) => e.id === eaId);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<"selected" | "allowed">("selected");

  if (!ea) return null;

  if (editing) {
    const sym = ea.symbols.find((s) => s.symbol === editing);
    if (!sym) return null;
    return <SymbolConfigForm eaId={eaId} sym={sym} onBack={() => setEditing(null)} />;
  }

  const allowedList = ea.symbols.filter((s) => s.allowed);
  const rows = tab === "selected" ? ea.symbols : allowedList;
  const counts = { selected: ea.symbols.length, allowed: allowedList.length };

  return (
    <>
      <header className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} aria-label="Back"
          className="size-11 shrink-0 rounded-full border border-primary/50 bg-background/60 grid place-items-center shadow-[0_0_18px_-6px_var(--primary)]">
          <ArrowLeft className="size-5 text-foreground" />
        </button>
        <div className="relative shrink-0">
          <span className="absolute -inset-1 rounded-full bg-primary/30 blur-md animate-pulse" aria-hidden />
          <img src={ea.image || avatar} alt="" className="relative size-12 rounded-full object-cover border-2 border-primary/60" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="bot-name font-display text-lg font-black leading-tight truncate">{ea.name}</h1>
          <div className="mt-1 flex gap-1.5">
            <span className={`${pill} ${pillOff}`}>{counts.selected} pairs</span>
            <span className={`${pill} ${pillOn}`}><span className="size-1.5 rounded-full bg-primary-foreground animate-pulse" />{counts.allowed} live</span>
          </div>
        </div>
      </header>

      {/* Segmented pill */}
      <div className="mx-4 flex rounded-full border border-primary/25 bg-card/90 backdrop-blur-md p-1">
        {(["selected", "allowed"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 h-10 rounded-full text-[12px] font-bold flex items-center justify-center gap-2 transition-all ${tab === t
              ? "bg-primary text-primary-foreground shadow-[0_0_22px_-4px_var(--primary)]"
              : "text-muted-foreground"}`}>
            {t === "selected" ? "Selected Quotes" : "Allowed Quotes"}
            <span className={`min-w-5 h-5 px-1.5 rounded-full text-[10px] grid place-items-center ${tab === t ? "bg-primary-foreground/20" : "bg-muted"}`}>{counts[t]}</span>
          </button>
        ))}
      </div>

      <div className="px-4 mt-5 space-y-3 pb-10">
        {rows.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-10 rounded-3xl border border-dashed border-primary/25">
            {tab === "selected" ? "No quotes yet — add symbols in the bot editor." : "No allowed quotes — allow one from Selected Quotes."}
          </p>
        ) : rows.map((s) => {
          const dir = (s.action || "BOTH").toUpperCase();
          const plat = String(s.platform || "MT4").toUpperCase();
          return (
            <div key={s.symbol}
              className={`rounded-3xl border p-3 transition-all ${s.allowed
                ? "border-primary/50 bg-card/90 backdrop-blur-md shadow-[0_0_26px_-12px_var(--primary)]"
                : "border-border bg-card/75 backdrop-blur-md"}`}>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditing(s.symbol)} aria-label={`Configure ${s.symbol}`}
                  className={`size-12 shrink-0 rounded-full grid place-items-center font-display text-[11px] font-black tracking-tight border-2 ${s.allowed
                    ? "border-primary bg-primary/15 text-primary shadow-[0_0_18px_-6px_var(--primary)]"
                    : "border-border bg-muted/40 text-muted-foreground"}`}>
                  {s.symbol.slice(0, 3)}
                </button>
                <button onClick={() => setEditing(s.symbol)} className="flex-1 min-w-0 text-left">
                  <p className="font-display text-base font-black leading-tight truncate">{s.symbol}</p>
                  <p className="text-[11px] font-semibold text-foreground/70">{plat === "MT5" ? "MetaTrader 5" : "MetaTrader 4"}</p>
                </button>
                <button onClick={() => portalActions.toggleSymbolAllowed(eaId, s.symbol)} role="switch" aria-checked={s.allowed}
                  aria-label={s.allowed ? `Disallow ${s.symbol}` : `Allow ${s.symbol}`}
                  className={`relative h-7 w-12 shrink-0 rounded-full border transition-all ${s.allowed ? "border-primary bg-primary/30 shadow-[0_0_14px_-4px_var(--primary)]" : "border-border bg-muted/50"}`}>
                  <span className={`absolute top-0.5 size-[22px] rounded-full transition-all ${s.allowed ? "left-[22px] bg-primary" : "left-0.5 bg-muted-foreground/60"}`} />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                <span className={`${pill} ${pillOff}`}>{s.lotSize || "0.01"} lots</span>
                <span className={`${pill} ${dir === "BOTH" ? pillOff : pillOn}`}>{dir}</span>
                <span className={`${pill} ${pillOff}`}>{s.trades || "1"} trades</span>
                <span className={`${pill} ${s.mode === "scalp" ? pillOn : pillOff}`}>{s.mode === "scalp" ? "Scalp" : "Normal"}</span>
                <button onClick={() => setEditing(s.symbol)}
                  className={`${pill} ml-auto border-primary text-primary bg-card`}>
                  Configure <ArrowRight className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function fmtLot(n: number) {
  return String(Math.max(0.01, Math.round(n * 100) / 100).toFixed(2));
}

function SymbolConfigForm({ eaId, sym, onBack }: { eaId: string; sym: SymbolConfig; onBack: () => void }) {
  const [lotSize, setLotSize] = useState(sym.lotSize || "0.01");
  const [action, setAction] = useState((sym.action || "BOTH").toUpperCase());
  const [trades, setTrades] = useState(sym.trades || "1");
  const [platform, setPlatform] = useState<"MT4" | "MT5">(String(sym.platform).toUpperCase() === "MT5" ? "MT5" : "MT4");
  const [mode, setMode] = useState<"normal" | "scalp">(sym.mode === "scalp" ? "scalp" : "normal");

  function save() {
    portalActions.updateSymbol(eaId, sym.symbol, { lotSize, action, trades, platform, mode, allowed: true });
    onBack();
  }
  const step = (d: number) => setLotSize(fmtLot((parseFloat(lotSize) || 0) + d));
  const label = "text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground";
  const seg = (on: boolean) => `flex-1 h-10 rounded-full text-[12px] font-bold tracking-wider transition-all ${on
    ? "bg-primary text-primary-foreground shadow-[0_0_20px_-4px_var(--primary)]" : "text-muted-foreground"}`;

  return (
    <>
      <header className="flex items-center gap-3 px-5 pt-5 pb-3">
        <button onClick={onBack} aria-label="Back"
          className="size-11 rounded-full border border-primary/50 bg-background/60 grid place-items-center shadow-[0_0_18px_-6px_var(--primary)]">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="font-display text-lg font-bold tracking-tight flex-1">Symbol setup</h1>
        <span className={`${pill} ${pillOn}`}>{platform}</span>
      </header>

      <div className="px-5 pb-10 space-y-4">
        {/* Hero */}
        <div className="flex flex-col items-center pt-2">
          <div className="relative">
            <span className="absolute -inset-2 rounded-full bg-primary/25 blur-xl animate-pulse" aria-hidden />
            <div className="relative size-24 rounded-full border-2 border-primary bg-card grid place-items-center shadow-[0_0_34px_-6px_var(--primary)]">
              <span className="font-display text-xl font-black text-primary">{sym.symbol.slice(0, 3)}</span>
            </div>
          </div>
          <h2 className="mt-3 font-display text-2xl font-black tracking-wide">{sym.symbol}</h2>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            <span className={`${pill} ${pillOff}`}>{lotSize || "—"} lots</span>
            <span className={`${pill} ${pillOn}`}>{action}</span>
            <span className={`${pill} ${pillOff}`}>{trades || "—"} trades</span>
          </div>
        </div>

        <section className="rounded-3xl border border-primary/30 bg-card/90 backdrop-blur-md p-4">
          <p className={label}>Platform</p>
          <div className="mt-2 flex rounded-full border border-primary/25 bg-card/90 backdrop-blur-md p-1">
            {(["MT4", "MT5"] as const).map((p) => (
              <button key={p} onClick={() => setPlatform(p)} className={seg(platform === p)}>MetaTrader {p === "MT5" ? "5" : "4"}</button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-primary/30 bg-card/90 backdrop-blur-md p-4">
          <p className={label}>Lot size</p>
          <div className="mt-2 flex items-center gap-2 rounded-full border border-primary/30 bg-background/50 p-1">
            <button onClick={() => step(-0.01)} aria-label="Decrease lot" className="size-10 rounded-full border border-primary/50 bg-card text-primary text-lg font-black">−</button>
            <Input value={lotSize} onChange={(e) => setLotSize(e.target.value)} inputMode="decimal" placeholder="0.01"
              className="h-10 flex-1 border-0 bg-transparent text-center font-mono text-base shadow-none focus-visible:ring-0" />
            <button onClick={() => step(0.01)} aria-label="Increase lot" className="size-10 rounded-full bg-primary text-primary-foreground text-lg font-black shadow-[0_0_16px_-4px_var(--primary)]">+</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {["0.01", "0.05", "0.10", "0.50", "1.00"].map((v) => (
              <button key={v} onClick={() => setLotSize(v)}
                className={`${pill} px-3 py-1.5 ${parseFloat(lotSize) === parseFloat(v) ? pillOn : pillOff}`}>{v}</button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-primary/30 bg-card/90 backdrop-blur-md p-4">
          <p className={label}>Number of trades</p>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {["1", "3", "5", "7", "9"].map((n) => (
              <button key={n} onClick={() => setTrades(n)}
                className={`aspect-square rounded-full grid place-items-center font-display text-base font-black border-2 transition ${trades === n
                  ? "border-primary bg-primary text-primary-foreground shadow-[0_0_22px_-4px_var(--primary)]"
                  : "border-border bg-background/60 text-foreground/80"}`}>{n}</button>
            ))}
          </div>
          <Input value={trades} onChange={(e) => setTrades(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric"
            placeholder="or type a number" className="mt-3 h-11 rounded-full bg-background/60 border-border text-center font-mono" />
        </section>

        <section className="rounded-3xl border border-primary/30 bg-card/90 backdrop-blur-md p-4">
          <p className={label}>Direction</p>
          <div className="mt-2 flex rounded-full border border-primary/25 bg-card/90 backdrop-blur-md p-1">
            {(["BUY", "SELL", "BOTH"] as const).map((a) => (
              <button key={a} onClick={() => setAction(a)} className={seg(action === a)}>{a}</button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-primary/30 bg-card/90 backdrop-blur-md p-4">
          <p className={label}>Trading mode</p>
          <div className="mt-2 flex rounded-full border border-primary/25 bg-card/90 backdrop-blur-md p-1">
            <button onClick={() => setMode("normal")} className={seg(mode === "normal")}>NORMAL</button>
            <button onClick={() => setMode("scalp")} className={seg(mode === "scalp")}>SCALP</button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {mode === "scalp" ? "Profit Sniper: same safe stop, quicker take profit (about 1× the stop)." : "Full AutoTrader Pro target, as before."}
          </p>
        </section>

        <Button onClick={save} className="w-full h-14 rounded-full bg-primary text-primary-foreground font-display font-extrabold tracking-widest shadow-[0_0_28px_-6px_var(--primary)]">
          <Check className="size-5" /> SAVE CONFIGURATION
        </Button>
      </div>
    </>
  );
}


/* ---------------- MetaTrader login via mtapi.io (MT4 + MT5) ---------------- */

function MetaTraderTab() {
  const { metaAccountId, metaPlatform, metaLogin, metaBroker, metaPassword, metaServer } = usePortalStore();
  const connectFn = useServerFn(connectBrokerAccount);
  const disconnectFn = useServerFn(disconnectBrokerAccount);
  const [platform, setPlatform] = useState<"MT4" | "MT5">("MT4");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "error" | "success"; text: string } | null>(null);

  const isConnected = !!metaAccountId;
  const connectedPlatform = (metaPlatform ?? "mt4").toUpperCase();
  const platformLower = platform.toLowerCase() as "mt4" | "mt5";
  const broker = (server.trim().split(/[-_ ]/)[0] || "Broker");


  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!account.trim() || !password || !server.trim()) {
      setMsg({ kind: "error", text: "Fill login, password and server." });
      return;
    }
    setBusy(true); setMsg({ kind: "info", text: `Connecting to ${platform} account…` });
    try {
      const res = await connectFn({ data: {
        platform: platformLower,
        broker, login: account.trim(), password, server: server.trim(),
      }});
      if (!res.ok) {
        setMsg({ kind: "error", text: `Login unsuccessful: ${res.error}` });
        return;
      }
      portalActions.setMetaAccount({
        accountId: res.accountId, platform: platformLower,
        login: account.trim(), broker, password, server: server.trim(),
      });
      const bal = res.balance != null ? `${res.balance} ${res.currency ?? ""}` : "—";
      setMsg({ kind: "success", text: `✓ ${platform} account connected · ${broker} · #${account.trim()} · balance ${bal}` });
      setPassword("");
    } catch (err: any) {
      setMsg({ kind: "error", text: `Login unsuccessful: ${err?.message ?? "network error"}` });
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (metaPlatform && metaLogin && metaPassword && metaServer) {
      try { await disconnectFn({ data: { platform: metaPlatform, login: metaLogin, password: metaPassword, server: metaServer } }); } catch { /* ignore */ }
    }
    portalActions.setMetaAccount(null);
    setMsg(null);
  }

  const [showPw, setShowPw] = useState(false);
  const shownPlatform = isConnected ? connectedPlatform : platform;
  const pillField = "h-14 rounded-full border border-primary/25 bg-background/60 pl-14 pr-5 text-[15px] shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground)_6%,transparent)] focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/30";
  const pillIcon = "absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-primary/15 border border-primary/30 grid place-items-center text-primary";

  return (
    <section className="relative px-5 pt-4 pb-10">
      {/* Hero */}
      <div className="relative flex flex-col items-center text-center">
        <div aria-hidden className="pointer-events-none absolute top-2 size-44 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative size-28 rounded-full p-[3px] bg-primary shadow-[0_0_30px_-6px_var(--primary)]">
          <div className="size-full rounded-full bg-background grid place-items-center">
            <div className="size-[88px] rounded-full border border-primary/40 bg-card/80 grid place-items-center">
              <span className="font-display text-3xl font-black tracking-tight">MT<span className="text-primary">{shownPlatform === "MT5" ? "5" : "4"}</span></span>
            </div>
          </div>
          <span className={`absolute -bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.25em] ${isConnected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
            <span className={`size-1.5 rounded-full ${isConnected ? "bg-primary-foreground animate-pulse" : "bg-muted-foreground/70"}`} />
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
        <h1 className="relative mt-6 font-display drop-shadow-[0_2px_10px_var(--background)] text-[26px] font-extrabold tracking-tight">
          {isConnected ? "Account linked" : <>Connect <span className="text-primary">MetaTrader</span></>}
        </h1>
        <p className="relative mt-2 rounded-full border border-border/50 bg-background/70 px-4 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
          {isConnected ? "Your robot is trading on this account." : "Link your broker so your robot can trade."}
        </p>
      </div>

      {/* Platform pill switch */}
      {!isConnected && (
        <div className="relative mx-auto mt-6 grid w-full max-w-[300px] grid-cols-2 rounded-full border border-primary/30 bg-card/60 p-1.5 shadow-[0_0_30px_-14px_var(--primary)]">
          <span aria-hidden className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] rounded-full bg-primary shadow-[0_0_30px_-6px_var(--primary)] transition-all duration-300 ${platform === "MT5" ? "left-[calc(50%)]" : "left-1.5"}`} />
          {(["MT4", "MT5"] as const).map((p) => (
            <button key={p} type="button" onClick={() => { setPlatform(p); setMsg(null); }}
              className={`relative z-10 h-11 rounded-full font-display text-sm font-extrabold tracking-[0.15em] transition-colors ${platform === p ? "text-primary-foreground" : "text-muted-foreground"}`}
            >{p}</button>
          ))}
        </div>
      )}

      <div
        className="relative mt-6 rounded-[32px] border border-primary/30 bg-gradient-to-b from-card/80 to-background/70 p-5 backdrop-blur"
        style={{ boxShadow: "0 20px 60px -30px var(--primary), inset 0 1px 0 0 color-mix(in oklab, var(--primary) 25%, transparent)" }}
      >
      {isConnected ? (
        <div>
          <div className="space-y-2.5">
            {[
              { icon: Plug, label: "Login", value: `#${metaLogin ?? ""}`, mono: true },
              { icon: TrendingUp, label: "Broker", value: metaBroker || "—", mono: false },
              { icon: Globe, label: "Server", value: metaServer || "—", mono: true },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 rounded-full border border-border/60 bg-background/60 p-1.5 pr-5">
                <span className="size-10 shrink-0 rounded-full bg-primary/15 border border-primary/30 grid place-items-center text-primary"><row.icon className="size-4" /></span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{row.label}</span>
                <span className={`ml-auto truncate text-sm font-bold ${row.mono ? "font-mono" : ""}`}>{row.value}</span>
              </div>
            ))}
          </div>
          <Button
            onClick={disconnect}
            variant="outline"
            className="mt-5 w-full h-14 rounded-full border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive font-display text-sm font-extrabold tracking-[0.2em]"
          >
            <Plug className="size-4 mr-2" /> DISCONNECT
          </Button>
          <OpenTradesList />
        </div>
      ) : (
        <form onSubmit={connect} className="space-y-4">
          <div className="space-y-2">
            <label className="pl-5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Login number</label>
            <div className="relative">
              <span className={pillIcon}><Plug className="size-4" /></span>
              <Input value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="e.g. 1200268027" inputMode="numeric"
                className={`${pillField} font-mono tracking-wider`} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="pl-5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Trading password</label>
            <div className="relative">
              <span className={pillIcon}><Radio className="size-4" /></span>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"}
                placeholder="••••••••" autoComplete="current-password"
                className={`${pillField} pr-20`} />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 rounded-full bg-primary/15 border border-primary/30 px-4 text-[10px] font-black tracking-widest text-primary">
                {showPw ? "HIDE" : "SHOW"}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="pl-5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Server</label>
            <div className="relative">
              <span className={pillIcon}><Globe className="size-4" /></span>
              <Input value={server} onChange={(e) => setServer(e.target.value)}
                placeholder="e.g. Exness-Real5"
                className={pillField} />
            </div>
            <p className="pl-5 text-[10px] text-muted-foreground">Use the exact server name from your {platform} terminal.</p>
          </div>

          <Button type="submit" disabled={busy} className="group mt-2 w-full h-16 rounded-full bg-primary hover:bg-primary/90 p-1.5 pl-7 text-primary-foreground font-display text-sm font-extrabold tracking-[0.2em] shadow-[0_0_40px_-10px_var(--primary)] justify-between">
            <span>{busy ? "CONNECTING…" : `CONNECT ${platform}`}</span>
            <span className="size-12 rounded-full bg-background/90 text-primary grid place-items-center transition-transform group-hover:translate-x-0.5">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />}
            </span>
          </Button>
          {msg && (
            <div className={`rounded-full border px-4 py-2.5 text-center text-xs ${msg.kind === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : msg.kind === "success" ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 bg-background/40 text-muted-foreground"}`}>
              {msg.text}
            </div>
          )}
        </form>
      )}
      </div>

      {!isConnected && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {["Auto-reconnect", "Encrypted", "MT4 & MT5"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground">
              <Check className="size-3 text-primary" /> {t}
            </span>
          ))}
        </div>
      )}

      <TradingTools />
    </section>
  );
}


/* ---------------- Custom Web Broker (any URL + API key) ---------------- */
function CustomWebBrokerSection() {
  const test = useServerFn(testCustomBroker);
  const exec = useServerFn(executeCustomBrokerOrder);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(() => (typeof localStorage !== "undefined" ? localStorage.getItem("customBrokerUrl") ?? "" : ""));
  const [apiKey, setApiKey] = useState(() => (typeof localStorage !== "undefined" ? localStorage.getItem("customBrokerKey") ?? "" : ""));
  const [symbol, setSymbol] = useState("XAUUSD");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [volume, setVolume] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("customBrokerUrl", url.trim());
    localStorage.setItem("customBrokerKey", apiKey.trim());
  }
  async function runTest() {
    if (!url || !apiKey) { setMsg("Enter URL + API key first."); return; }
    setBusy(true); setMsg("Pinging…");
    try {
      const r = await test({ data: { url: url.trim(), apiKey: apiKey.trim() } });
      setMsg(r.ok ? "✓ Endpoint reachable" : "✗ " + r.error);
      if (r.ok) save();
    } catch (e: any) { setMsg("✗ " + (e?.message ?? "error")); }
    setBusy(false);
  }
  async function sendOrder() {
    if (!url || !apiKey) { setMsg("Enter URL + API key first."); return; }
    setBusy(true); setMsg("Sending order…");
    try {
      const r = await exec({ data: {
        url: url.trim(), apiKey: apiKey.trim(),
        symbol: symbol.trim(), side,
        volume: Number(volume) || 0.01,
        comment: "custom-web~AlgoVault",
      }});
      setMsg(r.ok ? "✓ Order accepted" : "✗ " + r.error);
      if (r.ok) save();
    } catch (e: any) { setMsg("✗ " + (e?.message ?? "error")); }
    setBusy(false);
  }

  return (
    <div className="mt-6 rounded-2xl border border-primary/30 bg-card/40">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-4">
        <Globe className="size-5 text-primary" />
        <span className="flex-1 text-left font-display font-bold tracking-wider text-sm uppercase">Connect Any Web Broker</span>
        <span className={`text-primary transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="px-4 pb-5 space-y-3 border-t border-primary/20 pt-3">
          <p className="text-xs text-muted-foreground">Paste any broker's REST endpoint URL + API key. We POST orders server-side with Bearer auth.</p>
          <Input placeholder="https://your-broker.example.com/orders" value={url} onChange={(e) => setUrl(e.target.value)} className="h-12 rounded-xl bg-background/40" />
          <Input placeholder="API key / bearer token" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="h-12 rounded-xl bg-background/40" />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-12 rounded-xl bg-background/40" />
            <select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")} className="h-12 rounded-xl bg-background/40 border border-border px-3 text-sm">
              <option value="BUY">BUY</option><option value="SELL">SELL</option>
            </select>
            <Input placeholder="Volume" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-12 rounded-xl bg-background/40" />
          </div>
          {msg && <p className="text-xs text-center">{msg}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={runTest} disabled={busy} variant="outline" className="h-11 rounded-xl border-primary/40 text-primary font-semibold">Test</Button>
            <Button type="button" onClick={sendOrder} disabled={busy} className="h-11 rounded-xl bg-primary hover:bg-primary/90 font-semibold">Execute</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceCell({ label, value, tone }: { label: string; value: string; tone: "neutral" | "danger" | "success" }) {
  const color = tone === "danger" ? "text-red-400 border-red-500/40" : tone === "success" ? "text-emerald-400 border-emerald-500/40" : "text-white border-neutral-700";
  return (
    <div className={`rounded-xl bg-black/40 border ${color} p-2`}>
      <p className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="font-mono font-bold mt-0.5">{value}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-sm"><span className="text-muted-foreground">{k}</span><span className="font-mono font-semibold">{v}</span></div>;
}

/* ---------------- Settings ---------------- */
function SettingsSection({ icon: Icon, title, badge, children, defaultOpen }: { icon: any; title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 rounded-[2rem] border border-primary/70 bg-black/50 px-5 py-4 shadow-[0_0_26px_-10px_var(--primary),inset_0_0_30px_-24px_var(--primary)]"
      >
        <Icon className="size-5 shrink-0 text-primary/90" />
        <span className="flex-1 text-left font-display text-[15px] font-bold text-foreground">{title}</span>
        {badge && <span className="text-[10px] font-black rounded-full bg-primary text-primary-foreground px-2 py-0.5">{badge}</span>}
        <span className={`text-muted-foreground text-xs transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="rounded-3xl border border-primary/30 bg-black/40 px-4 py-4 shadow-[inset_0_0_30px_-24px_var(--primary)]">
          {children}
        </div>
      )}
    </div>
  );

}

const FULL_PALETTE = [
  "#22d3ee","#3b82f6","#2563eb","#1d4ed8","#4f46e5","#6366f1","#818cf8","#14b8a6",
  "#10b981","#22c55e","#16a34a","#15803d","#84cc16","#eab308","#f59e0b","#d97706",
  "#a16207","#92400e","#f97316","#fb923c","#ef4444","#dc2626","#7f1d1d","#ec4899",
  "#f472b6","#c026d3","#a855f7","#8b5cf6","#7c3aed","#6d28d9","#94a3b8","#22c55e",
];

function TradingViewModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const src = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}&interval=15&theme=light&style=1&hide_top_toolbar=0&hide_side_toolbar=0&allow_symbol_change=1&withdateranges=1&studies=%5B%5D`;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-display font-bold">TradingView · {symbol}</span>
        <button onClick={onClose} className="size-10 rounded-full bg-card border border-border grid place-items-center">✕</button>
      </div>
      <iframe title="TradingView" src={src} className="flex-1 w-full" allow="clipboard-write" />
    </div>
  );
}

/* ---------------- Settings panels ---------------- */
function ThemeToggle() {
  // The app is locked to light mode; dark is no longer offered.
  useEffect(() => {
    document.documentElement.classList.add("light");
    try { localStorage.removeItem("appTheme"); } catch {}
  }, []);
  return (
    <div className="h-14 rounded-xl border border-primary bg-primary/10 text-primary font-semibold flex items-center justify-center gap-2">
      <Sun className="size-4" /> Light mode (always on)
    </div>
  );
}

function NotificationsPanel() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  });
  const [trades, setTrades] = useState(true);
  const [signals, setSignals] = useState(true);
  async function request() {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") new Notification("Algo Vault EA", { body: "Notifications enabled" });
  }
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card/60 p-3 text-sm">
        Browser permission: <span className={`font-bold ${perm === "granted" ? "text-primary" : "text-muted-foreground"}`}>{perm}</span>
      </div>
      {perm !== "granted" && perm !== "unsupported" && (
        <Button onClick={request} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-bold">Enable Push Notifications</Button>
      )}
      {[
        ["Trade fills", trades, setTrades],
        ["New signals", signals, setSignals],
      ].map(([label, val, set]: any) => (
        <label key={label} className="flex items-center justify-between rounded-xl bg-card/60 border border-border p-3">
          <span className="text-sm font-semibold">{label}</span>
          <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} className="size-5 accent-[var(--primary)]" />
        </label>
      ))}
    </div>
  );
}

function PWAInstallPanel() {
  const [, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia?.("(display-mode: standalone)").matches) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return (
    <div className="space-y-3">
      {installed ? (
        <p className="text-sm text-primary font-semibold text-center">✓ Installed — open from your home screen</p>
      ) : (
        <>
          <button
            type="button"
            onClick={async () => {
              const m = await import("@/lib/app-file.functions");
              const r = await m.getApkDownload().catch(() => null);
              if (r?.url) window.location.href = r.url;
              else alert("The Android app file isn't available yet. Please try again later.");
            }}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2"
          >
            <Smartphone className="size-4" /> Download Android app (.apk)
          </button>
          <p className="text-[11px] text-muted-foreground text-center">
            Android may ask you to allow installs from your browser — tap allow, then open the file.
          </p>

          <div className="rounded-xl border border-border bg-card/60 p-3">
            <p className="font-semibold text-sm flex items-center gap-2"><Apple className="size-4" /> Install on iPhone (Safari)</p>
            <ol className="mt-2 text-xs text-muted-foreground list-decimal pl-4 space-y-1">
              <li>Open this page in Safari.</li>
              <li>Tap the Share icon.</li>
              <li>Choose "Add to Home Screen".</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

function AccountBrokerPanel() {
  const { metaAccountId, metaBroker, metaLogin, activatedEmail } = usePortalStore();
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card/60 p-3 text-sm">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Signed in as</p>
        <p className="font-semibold mt-1">{activatedEmail || "—"}</p>
      </div>
      <div className="rounded-xl border border-border bg-card/60 p-3 text-sm">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Broker</p>
        {metaAccountId ? (
          <p className="font-semibold mt-1 text-primary">✓ {metaBroker} #{metaLogin}</p>
        ) : (
          <p className="font-semibold mt-1 text-muted-foreground">Not connected</p>
        )}
      </div>
      <Link to="/broker" className="block w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-center leading-[3rem]">
        Manage Broker Connections
      </Link>
      <Button variant="outline" onClick={() => portalActions.setActivatedEmail(null)} className="w-full h-12 rounded-xl border-border font-semibold">
        Sign out
      </Button>
    </div>
  );
}

