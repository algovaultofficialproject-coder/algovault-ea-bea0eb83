import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Copy, Cpu, Plus, Save, Trash2 } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { botCodeFor, exportPortalState, portalActions, usePortalStore, type SymbolConfig } from "@/lib/portal-store";
import { savePortalState } from "@/lib/portal-state.functions";
import { publishEAConfig } from "@/lib/ea-config.functions";
import botLogo from "@/assets/bot-logo.jpg";

export const Route = createFileRoute("/bot-editor_/$eaId")({
  head: () => ({ meta: [
    { title: "Bot Editor — Algo Vault EA" },
    { name: "description", content: "Edit your bot name and trading symbols, save changes, or delete your bot." },
    { property: "og:title", content: "Bot Editor — Algo Vault EA" },
    { property: "og:description", content: "Manage your bot name and trading symbols." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <AuthGate><Editor /></AuthGate>,
});

function Editor() {
  const { eaId } = Route.useParams();
  const navigate = useNavigate();
  const { eas, profileImage } = usePortalStore();
  const ea = eas.find((e) => e.id === eaId);
  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState<SymbolConfig[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const save = useServerFn(savePortalState);
  const publish = useServerFn(publishEAConfig);

  useEffect(() => {
    if (!ea || loadedId === ea.id) return;
    setName(ea.name);
    setSymbols(ea.symbols.map((s) => ({ ...s })));
    setLoadedId(ea.id);
  }, [ea, loadedId]);

  if (!ea) return <div className="min-h-screen grid place-items-center text-muted-foreground"><Link to="/manage-eas">Back to Manage EAs</Link></div>;
  const botCode = ea.code || botCodeFor(ea.id);
  const dirty = name.trim() !== ea.name || JSON.stringify(symbols) !== JSON.stringify(ea.symbols);

  function addSymbol(value: string) {
    const symbol = value.trim();
    if (!symbol || symbol.length > 32 || symbols.some((s) => s.symbol.toLowerCase() === symbol.toLowerCase())) return;
    setSymbols((rows) => [...rows, { symbol, lotSize: "0.01", action: "BOTH", platform: "MT4", allowed: false }]);
    setCustom(""); setMessage("");
  }

  async function saveChanges() {
    if (!ea || !name.trim()) return;
    setBusy(true); setMessage("");
    try {
      const updated = { ...ea, name: name.trim(), symbols };
      const snapshot = exportPortalState();
      await save({ data: { json: JSON.stringify({ ...snapshot,
        eas: snapshot.eas.map((e) => e.id === ea.id ? updated : e),
        licenses: snapshot.licenses.map((l) => l.ea === ea.name ? { ...l, ea: updated.name } : l),
      }) } });
      portalActions.updateEA(ea.id, { name: updated.name, symbols });
      await publish({ data: { code: botCode, payload: { id: ea.id, name: updated.name, image: ea.image ?? null, backgroundVideo: ea.backgroundVideo ?? null, symbols } } });
      setMessage("Changes saved.");
    } catch {
      setMessage("Could not save all changes. Please try again.");
    } finally { setBusy(false); }
  }

  async function deleteBot() {
    if (!ea) return;
    setBusy(true); setMessage("");
    try {
      const snapshot = exportPortalState();
      await save({ data: { json: JSON.stringify({ ...snapshot,
        eas: snapshot.eas.filter((e) => e.id !== ea.id),
        licenses: snapshot.licenses.filter((l) => l.ea !== ea.name),
        activeEAId: snapshot.activeEAId === ea.id ? null : snapshot.activeEAId,
      }) } });
      portalActions.removeEA(ea.id);
      await navigate({ to: "/manage-eas" });
    } catch { setMessage("Could not delete the bot. Please try again."); setDeleting(false); }
    finally { setBusy(false); }
  }

  const POPULAR = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "USDCAD", "NAS100", "US30"];
  const allowedCount = symbols.filter((s) => s.allowed).length;
  return <div className="min-h-screen bg-background bg-hero-glow text-foreground pb-32">
    <header className="sticky top-0 z-30 flex items-center gap-3 px-5 py-4 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <Button variant="outline" size="icon" className="rounded-xl" asChild><Link to="/manage-eas" aria-label="Back to Manage EAs"><ArrowLeft className="size-4" /></Link></Button>
      <h1 className="font-display text-sm font-bold tracking-[0.2em]">BOT EDITOR</h1>
      {dirty && <span className="ml-auto rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Unsaved</span>}
    </header>
    <main className="max-w-2xl mx-auto px-5 pt-6 space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-card p-6 shadow-card">
        <div className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-primary/20 blur-3xl" />
        <div className="flex items-center gap-4">
          <img src={ea.image || profileImage || botLogo} alt={ea.name} className="size-20 shrink-0 rounded-3xl object-cover border-2 border-primary/50 shadow-card" />
          <div className="flex-1 min-w-0">
            <label htmlFor="bot-name" className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Bot name</label>
            <Input id="bot-name" value={name} maxLength={100} disabled={busy} onChange={(e) => { setName(e.target.value); setMessage(""); }} className="mt-1.5 h-12 rounded-xl bg-background/50 font-display text-lg font-bold" />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Cpu className="size-3.5" /> Bot code</p>
            <code className="mt-0.5 block font-mono text-lg font-bold break-all">{botCode}</code>
          </div>
          <Button variant="outline" size="icon" className="rounded-xl shrink-0" aria-label="Copy bot code" onClick={() => navigator.clipboard.writeText(botCode).then(() => setMessage("Bot code copied.")).catch(() => setMessage("Copy failed. Please try again."))}><Copy className="size-4" /></Button>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card/60 p-5 space-y-4">
        <div className="flex items-end justify-between">
          <div><h2 className="text-lg font-display font-bold">Trading symbols</h2><p className="text-xs text-muted-foreground">{allowedCount} of {symbols.length} switched on</p></div>
        </div>
        <div className="space-y-2">
          {symbols.map((s) => <div key={s.symbol} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition ${s.allowed ? "border-primary/40 bg-primary/5" : "border-border bg-background/40"}`}>
            <span className={`size-9 shrink-0 rounded-xl grid place-items-center text-[10px] font-bold ${s.allowed ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{s.symbol.slice(0, 3).toUpperCase()}</span>
            <div className="flex-1 min-w-0"><div className="break-all font-mono text-sm font-semibold">{s.symbol}</div><div className="text-[10px] text-muted-foreground">{s.lotSize} lots · {s.action} · {s.platform}</div></div>
            <Switch checked={s.allowed} disabled={busy} aria-label={`Allow ${s.symbol}`} onCheckedChange={(allowed) => setSymbols((rows) => rows.map((r) => r.symbol === s.symbol ? { ...r, allowed } : r))} />
            <Button variant="ghost" size="icon" disabled={busy} aria-label={`Remove ${s.symbol}`} onClick={() => setSymbols((rows) => rows.filter((r) => r.symbol !== s.symbol))}><Trash2 className="size-4 text-destructive" /></Button>
          </div>)}
          {symbols.length === 0 && <p className="rounded-2xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No symbols added yet.</p>}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Quick add</p>
          <div className="flex flex-wrap gap-2">{POPULAR.map((s) => <Button key={s} variant="outline" size="sm" className="rounded-full" disabled={busy || symbols.some((r) => r.symbol.toLowerCase() === s.toLowerCase())} onClick={() => addSymbol(s)}><Plus className="size-3" />{s}</Button>)}</div>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSymbol(custom); }}>
          <Input aria-label="Custom symbol" placeholder="Custom symbol, e.g. XAUUSDm" maxLength={32} disabled={busy} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-11 rounded-xl bg-background/40" />
          <Button type="submit" variant="outline" className="h-11 rounded-xl" disabled={busy || !custom.trim()}><Plus className="size-4" /> Add</Button>
        </form>
      </section>

      <section className="rounded-3xl border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="font-display font-bold">Danger zone</h2>
        <p className="mt-1 text-xs text-muted-foreground">Deleting removes the bot, its symbols and its licences.</p>
        <Button variant="destructive" className="mt-3 w-full h-11 rounded-xl" disabled={busy} onClick={() => setDeleting(true)}><Trash2 className="size-4" /> Delete Bot</Button>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/40 bg-background/85 backdrop-blur-xl px-5 py-3">
        <div className="mx-auto max-w-2xl">
          <Button className="w-full h-12 rounded-xl font-semibold" disabled={busy || !name.trim()} onClick={saveChanges}><Save className="size-4" />{busy ? "Saving…" : "Save Changes"}</Button>
          <p role="status" className="mt-1 min-h-4 text-center text-xs text-muted-foreground">{message || (dirty ? "You have unsaved changes" : "")}</p>
        </div>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {ea.name}?</AlertDialogTitle><AlertDialogDescription>This removes the bot, its symbols and its licences from your workspace. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={deleteBot}>{busy ? "Deleting…" : "Confirm Delete"}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  </div>;
}
