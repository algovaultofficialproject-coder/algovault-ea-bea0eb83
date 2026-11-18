import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useMemo, useState } from "react";
import {
  LogOut, Play, Pause, BarChart3, History, Home, Database, Scan, Settings as SettingsIcon,
  Crown, Plus, Info, Server, Key as KeyIcon, User as UserIcon, X, Search, Palette, LayoutGrid, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalStore, portalActions, THEMES, HOME_STYLES } from "@/lib/portal-store";

type Tab = "home" | "meta" | "scan" | "settings";

export const Route = createFileRoute("/robot/$eaId")({
  head: () => ({
    meta: [
      { title: "Robot Control — Algo Vault EA" },
      { property: "og:title", content: "Robot Control — Algo Vault EA" },
      { property: "og:description", content: "Run and monitor your AlgoVault Expert Advisor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Run and monitor your Expert Advisor in real time." },
    ],
  }),
  component: () => (<AuthGate><RobotControl /></AuthGate>),
});

function RobotControl() {
  const { eaId } = Route.useParams();
  const { eas, licenses, profileImage } = usePortalStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("home");
  const [running, setRunning] = useState(false);

  const ea = eas.find((e) => e.id === eaId);
  const license = useMemo(
    () => licenses.find((l) => ea && l.ea === ea.name && l.active),
    [licenses, ea],
  );

  if (!ea) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6 text-center">
        <div>
          <p className="text-lg font-semibold">Bot not found</p>
          <p className="text-sm text-muted-foreground mt-2">It may have been removed from the portal.</p>
          <Link to="/dashboard" className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-primary-foreground font-semibold">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-background to-background" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-primary/20 blur-[120px]" />
      </div>

      <div className="relative max-w-md mx-auto pb-28">
        <header className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-bold tracking-wider">TRADE PORT</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              <Crown className="size-3" fill="currentColor" /> PRO
            </span>
          </div>
          <Link to="/dashboard" className="size-10 rounded-full bg-card/60 border border-border grid place-items-center" aria-label="Exit">
            <LogOut className="size-4" />
          </Link>
        </header>

        {tab === "home" && (
          <HomeTab
            ea={ea}
            license={license}
            running={running}
            setRunning={setRunning}
            profileImage={profileImage}
            onAddNew={() => navigate({ to: "/activate" })}
            allEas={eas}
            onPickEa={(id) => navigate({ to: "/robot/$eaId", params: { eaId: id } })}
          />
        )}
        {tab === "meta" && <MetaTraderTab />}
        {tab === "scan" && <ScannerTab />}
        {tab === "settings" && <SettingsTab />}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/90 backdrop-blur-xl">
        <div className="max-w-md mx-auto grid grid-cols-4 py-3">
          <TabItem icon={Home} label="Home" active={tab === "home"} onClick={() => setTab("home")} />
          <TabItem icon={Database} label="Metatrader" active={tab === "meta"} onClick={() => setTab("meta")} />
          <TabItem icon={Scan} label="Scanner" active={tab === "scan"} onClick={() => setTab("scan")} />
          <TabItem icon={SettingsIcon} label="Settings" active={tab === "settings"} onClick={() => setTab("settings")} />
        </div>
      </nav>
    </div>
  );
}

function HomeTab({
  ea, license, running, setRunning, profileImage, onAddNew, allEas, onPickEa,
}: {
  ea: { id: string; name: string; image?: string | null };
  license: { duration: string; key: string } | undefined;
  running: boolean;
  setRunning: (v: boolean) => void;
  profileImage: string | null;
  onAddNew: () => void;
  allEas: { id: string; name: string; image?: string | null }[];
  onPickEa: (id: string) => void;
}) {
  const initials = ea.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const avatar = ea.image || profileImage;

  return (
    <>
      <div className="flex flex-col items-center px-5">
        <div className="relative">
          <div className={`size-56 rounded-full border-4 shadow-glow grid place-items-center overflow-hidden bg-gradient-to-br from-primary/30 to-background transition ${running ? "border-green-400 animate-pulse" : "border-primary"}`}>
            {avatar ? (
              <img src={avatar} alt={ea.name} className="size-full object-cover" />
            ) : (
              <span className="font-display text-7xl font-bold tracking-tighter">{initials}</span>
            )}
          </div>
        </div>
        <p className="mt-4 text-xs tracking-[0.3em] text-muted-foreground uppercase">You are trading with</p>
        <h1 className="bot-name mt-1 font-display text-4xl font-bold text-center leading-tight">{ea.name}</h1>
        {license && (
          <p className="mt-2 text-xs tracking-[0.25em] text-primary uppercase">{license.duration} · Active</p>
        )}
      </div>

      <section className="mt-8 mx-5 rounded-full border border-primary/40 bg-card/40 backdrop-blur-md p-3 flex items-center justify-between shadow-glow">
        <button className="flex flex-col items-center gap-1 px-4 text-primary">
          <BarChart3 className="size-5" />
          <span className="text-xs font-semibold">PAIRS</span>
        </button>
        <button
          onClick={() => setRunning(!running)}
          className="size-20 rounded-full grid place-items-center text-primary-foreground font-bold shadow-glow bg-gradient-primary"
          aria-label={running ? "Stop" : "Start"}
        >
          {running ? (
            <div className="flex flex-col items-center"><Pause className="size-7" fill="currentColor" /><span className="text-[10px] mt-0.5">STOP</span></div>
          ) : (
            <div className="flex flex-col items-center"><Play className="size-7" fill="currentColor" /><span className="text-[10px] mt-0.5">START</span></div>
          )}
        </button>
        <button className="flex flex-col items-center gap-1 px-4 text-primary">
          <History className="size-5" />
          <span className="text-xs font-semibold">LOGS</span>
        </button>
      </section>

      <p className="mt-5 text-center text-xs tracking-[0.35em] text-muted-foreground uppercase">Powered by Algo Vault EA</p>

      <section className="mt-6 px-5">
        <h2 className="text-xs tracking-[0.3em] uppercase text-muted-foreground mb-3">Robot List</h2>
        <div className="space-y-2">
          {allEas.map((b) => (
            <button
              key={b.id}
              onClick={() => onPickEa(b.id)}
              className={`w-full flex items-center gap-4 rounded-2xl border bg-card/40 p-3 pr-5 transition ${b.id === ea.id ? "border-primary shadow-glow" : "border-border hover:border-primary/40"}`}
            >
              <div className="size-12 rounded-xl bg-gradient-primary border border-primary/40 grid place-items-center overflow-hidden text-lg font-bold text-primary-foreground">
                {b.image || profileImage ? <img src={(b.image || profileImage)!} alt="" className="size-full object-cover" /> : b.name.charAt(0)}
              </div>
              <div className="flex-1 text-left">
                <p className="font-display text-base font-bold">{b.name}</p>
                {b.id === ea.id && license && <p className="text-xs text-muted-foreground">{license.duration}</p>}
              </div>
              <Info className="size-4 text-muted-foreground" />
            </button>
          ))}

          <button
            onClick={onAddNew}
            className="w-full flex items-center gap-4 rounded-2xl border border-dashed border-primary/50 bg-card/30 p-3 pr-5"
          >
            <div className="size-12 rounded-xl border border-dashed border-primary/60 grid place-items-center text-primary">
              <Plus className="size-6" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-display text-base font-bold">Connect New EA</p>
              <p className="text-xs text-muted-foreground">Must have a new license key</p>
            </div>
          </button>
        </div>
      </section>
    </>
  );
}

function MetaTraderTab() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [connected, setConnected] = useState(false);

  return (
    <section className="px-5 mt-2">
      <div className="rounded-3xl border border-primary/40 bg-gradient-to-b from-primary/15 to-background p-5 shadow-glow">
        <div className="flex items-center justify-center -mt-9 mb-4">
          <span className="rounded-full bg-background border border-primary/40 px-5 py-2 font-display text-xs tracking-[0.3em]">
            MT5 LOGIN · #1
          </span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <span className={`inline-flex items-center gap-2 text-xs ${connected ? "text-green-400" : "text-muted-foreground"}`}>
            <span className={`size-2 rounded-full ${connected ? "bg-green-400" : "bg-muted"}`} />
            {connected ? "Connected" : "Not connected"}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-6 rounded-full bg-foreground" />
            <span className="size-1.5 rounded-full bg-muted-foreground" />
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); setConnected(true); }} className="space-y-5">
          <MtField label="Account Number" icon={Database}>
            <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="123456789" inputMode="numeric"
              className="h-14 rounded-2xl bg-background/60 border-border pl-12" />
          </MtField>
          <MtField label="Password" icon={KeyIcon}>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••"
              className="h-14 rounded-2xl bg-background/60 border-border pl-12" />
          </MtField>
          <MtField label="Server" icon={Server}>
            <Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="ICMarkets-MT5"
              className="h-14 rounded-2xl bg-background/60 border-border pl-12" />
          </MtField>

          <Button type="button" variant="outline" className="w-full h-14 rounded-2xl border-border bg-card/60">
            <Search className="size-4 mr-2" /> Find a broker
          </Button>

          <Button type="submit" className="w-full h-14 rounded-2xl bg-gradient-primary hover:opacity-90 shadow-glow font-semibold">
            Connect MT5 #1
          </Button>
        </form>
      </div>
    </section>
  );
}

function MtField({ label, icon: Icon, children }: { label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-2">{label}</label>
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
        {children}
      </div>
    </div>
  );
}

function ScannerTab() {
  return (
    <section className="px-5 mt-6 text-center">
      <div className="rounded-3xl border border-border bg-card/40 p-10">
        <Scan className="size-12 text-primary mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold">Market Scanner</h2>
        <p className="mt-2 text-sm text-muted-foreground">Live market scanning coming soon.</p>
      </div>
    </section>
  );
}

function SettingsTab() {
  const { themeId, homeStyle } = usePortalStore();
  return (
    <section className="px-5 mt-2 space-y-6">
      <div className="rounded-3xl border border-border bg-gradient-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="size-5 text-primary" />
          <h2 className="font-display text-lg font-bold">App Color</h2>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => portalActions.setTheme(t.id)}
              className={`relative aspect-square rounded-2xl border-2 transition ${themeId === t.id ? "border-foreground scale-105" : "border-border"}`}
              style={{ background: t.swatch }}
              aria-label={t.label}
            >
              {themeId === t.id && (
                <Check className="absolute inset-0 m-auto size-6 text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Pick a color — applied app-wide.</p>
      </div>

      <div className="rounded-3xl border border-border bg-gradient-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <LayoutGrid className="size-5 text-primary" />
          <h2 className="font-display text-lg font-bold">Home Style</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {HOME_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => portalActions.setHomeStyle(s.id)}
              className={`rounded-2xl border p-4 text-sm font-semibold transition ${homeStyle === s.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-gradient-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="size-5 text-primary" />
          <h2 className="font-display text-lg font-bold">Account</h2>
        </div>
        <Link to="/profile" className="block rounded-2xl border border-border bg-card/60 p-4 hover:border-primary/40">
          Edit Profile & Picture →
        </Link>
      </div>
    </section>
  );
}

function TabItem({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
      <Icon className="size-5" />
      {label}
    </button>
  );
}
