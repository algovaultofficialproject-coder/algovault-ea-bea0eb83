import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Image as ImageIcon, Menu, Pencil, Plus, SlidersHorizontal, Trash2, X, Zap } from "lucide-react";
import { MentorSidebar } from "@/components/MentorSidebar";
import { canAddMentorBot } from "@/lib/mentor-bot-limit";
import { exportPortalState, getPortalState, portalActions, usePortalStore, type EA, type SymbolConfig } from "@/lib/portal-store";
import { savePortalState } from "@/lib/portal-state.functions";

const pill = "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:opacity-40 disabled:pointer-events-none";
const neonBtn = `${pill} bg-primary text-primary-foreground neon-ring hover:brightness-110`;
const softBtn = `${pill} border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20`;
const card = "rounded-[2rem] border border-primary/40 bg-card neon-ring";
const field = "h-12 w-full rounded-full border border-primary/30 bg-background px-5 text-sm outline-none focus:border-primary";

/** Shrinks a picture so it fits in saved storage and syncs to the account. */
function readImage(file: File, cb: (dataUrl: string) => void) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 512 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    cb(c.toDataURL("image/jpeg", 0.85));
  };
  img.src = url;
}

type Draft = { id: string | null; name: string; image: string | null; symbols: string[] };

export function EaManager({ title }: { title: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { eas } = usePortalStore();
  const canAdd = canAddMentorBot(eas);
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useServerFn(savePortalState);
  const persist = async () => { try { await save({ data: { json: JSON.stringify(exportPortalState()) } }); } catch { /* offline — local copy kept */ } };

  const startEdit = (ea: EA) => setDraft({ id: ea.id, name: ea.name, image: ea.image ?? null, symbols: ea.symbols.map((s) => s.symbol) });

  function commit() {
    if (!draft || !draft.name.trim()) return;
    let id = draft.id;
    if (!id) {
      if (!portalActions.addEA(draft.name.trim())) return;
      id = getPortalState().eas.at(-1)!.id;
    }
    const prev = getPortalState().eas.find((e) => e.id === id)?.symbols ?? [];
    const symbols: SymbolConfig[] = draft.symbols.map((sym) =>
      prev.find((p) => p.symbol.toLowerCase() === sym.toLowerCase()) ?? { symbol: sym, lotSize: "0.01", action: "BOTH", platform: "MT4", allowed: false });
    const name = draft.id ? (getPortalState().eas.find((e) => e.id === id)?.name ?? draft.name) : draft.name.trim();
    portalActions.updateEA(id, { name, symbols });
    portalActions.setEAImage(id, draft.image);
    setDraft(null);
    void persist();
  }

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-3 backdrop-blur-xl bg-background/70 border-b border-primary/20">
        <button onClick={() => setMenuOpen(true)} className="size-12 rounded-full border border-border bg-card/60 grid place-items-center" aria-label="Open menu"><Menu className="size-5" /></button>
        <span className="size-12 rounded-full border border-primary/50 bg-primary/10 text-primary grid place-items-center neon-ring" aria-hidden><Bot className="size-5" /></span>
      </header>

      <main className="px-5 pt-6 pb-16 max-w-xl mx-auto space-y-6">
        <section className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold leading-tight">{title}</h1>
            <p className="mt-2 text-muted-foreground">Create and manage your Expert Advisors</p>
            <p className={`mt-2 text-sm font-semibold ${canAdd ? "neon-text" : "text-destructive"}`}>1 EA per mentor · {eas.length}/1 used</p>
          </div>
          <button type="button" disabled={!canAdd || !!draft} onClick={() => setDraft({ id: null, name: "", image: null, symbols: [] })} className={`${neonBtn} h-12 px-5`}>
            <Plus className="size-4" /> Create EA
          </button>
        </section>

        {draft && <EditorCard draft={draft} setDraft={setDraft} onSave={commit} />}

        {eas.length === 0 && !draft ? (
          <div className={`${card} px-6 py-14 text-center`}>
            <Bot className="mx-auto size-14 text-primary/70" />
            <p className="mt-4 text-muted-foreground">No EAs created yet. Tap "Create EA" to get started.</p>
          </div>
        ) : eas.map((ea) => (
          <article key={ea.id} className={`${card} p-5`}>
            <div className="flex items-center gap-4">
              <div className="size-20 shrink-0 overflow-hidden rounded-3xl border-2 border-primary/60 neon-ring bg-gradient-primary grid place-items-center text-2xl font-bold text-primary-foreground">
                {ea.image ? <img src={ea.image} alt="" className="size-full object-cover" /> : ea.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="bot-name font-display text-xl font-bold leading-tight break-words">{ea.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">Bot ID {ea.code} · {ea.users} users · {ea.active} active</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => startEdit(ea)} aria-label={`Edit ${ea.name}`} className="size-10 rounded-full grid place-items-center text-muted-foreground hover:text-primary"><Pencil className="size-5" /></button>
                <button type="button" aria-label={`Delete ${ea.name}`} className="size-10 rounded-full grid place-items-center text-muted-foreground hover:text-destructive"
                  onClick={() => { if (confirm(`Delete ${ea.name}? This also removes its licences.`)) { portalActions.removeEA(ea.id); void persist(); } }}><Trash2 className="size-5" /></button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {ea.symbols.map((s) => <span key={s.symbol} className="rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-sm font-semibold uppercase text-primary">{s.symbol}</span>)}
              {ea.symbols.length === 0 && <span className="text-xs text-muted-foreground">No symbols yet — tap the pencil to add some.</span>}
            </div>
            <Link to="/bot-editor/$eaId" params={{ eaId: ea.id }} className={`${softBtn} mt-4 h-10 w-full text-sm`}><SlidersHorizontal className="size-4" /> Video & pair settings</Link>
          </article>
        ))}

        <footer className="pt-6 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2 font-display font-semibold"><Zap className="size-4 text-primary" fill="currentColor" />Algo <span className="neon-text">Vault</span> EA</div>
          <p className="text-sm text-muted-foreground">© 2026 All rights reserved.</p>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary"><span className="size-2 rounded-full bg-primary neon-ring" />Systems Online</span>
        </footer>
      </main>
    </div>
  );
}

function EditorCard({ draft, setDraft, onSave }: { draft: Draft; setDraft: (d: Draft | null) => void; onSave: () => void }) {
  const [sym, setSym] = useState("");
  const editing = !!draft.id;
  const addSym = () => {
    const s = sym.trim().toUpperCase();
    if (s && !draft.symbols.some((x) => x.toLowerCase() === s.toLowerCase())) setDraft({ ...draft, symbols: [...draft.symbols, s] });
    setSym("");
  };
  return (
    <section className={`${card} p-6 space-y-6`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">{editing ? "Edit Expert Advisor" : "New Expert Advisor"}</h2>
        <button type="button" onClick={() => setDraft(null)} aria-label="Close" className="size-10 rounded-full grid place-items-center text-muted-foreground hover:text-foreground"><X className="size-6" /></button>
      </div>
      <div>
        <label htmlFor="ea-name" className="text-sm font-semibold text-muted-foreground">EA Name</label>
        <input id="ea-name" value={draft.name} disabled={editing} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Gold Scalper Pro" className={`${field} mt-2 disabled:opacity-60`} />
        {editing && <p className="mt-2 text-xs text-muted-foreground">EA name cannot be changed</p>}
      </div>
      <div>
        <p className="text-sm font-semibold text-muted-foreground">EA Image</p>
        <div className="mt-2 flex items-center gap-4">
          <div className={`size-24 shrink-0 overflow-hidden rounded-3xl grid place-items-center ${draft.image ? "border-2 border-primary/60 neon-ring" : "border-2 border-dashed border-primary/40 bg-primary/5"}`}>
            {draft.image ? <img src={draft.image} alt="" className="size-full object-cover" /> : <ImageIcon className="size-8 text-muted-foreground" />}
          </div>
          <label className={`${softBtn} h-12 flex-1 cursor-pointer px-4`}>
            <ImageIcon className="size-4" /> {draft.image ? "Change Image" : "Upload Image"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && readImage(e.target.files[0], (d) => setDraft({ ...draft, image: d }))} />
          </label>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-muted-foreground">Symbols</p>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addSym(); }}>
          <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder="e.g. XAUUSD" aria-label="New symbol" className={field} />
          <button type="submit" className={`${neonBtn} h-12 px-6`}>Add</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.symbols.map((s) => (
            <span key={s} className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 py-1.5 pl-4 pr-2 text-sm font-semibold text-primary">
              {s}<button type="button" onClick={() => setDraft({ ...draft, symbols: draft.symbols.filter((x) => x !== s) })} aria-label={`Remove ${s}`} className="size-6 rounded-full grid place-items-center hover:bg-primary/20"><X className="size-3.5" /></button>
            </span>
          ))}
        </div>
      </div>
      <button type="button" onClick={onSave} disabled={!draft.name.trim()} className={`${neonBtn} h-14 w-full text-base`}>{editing ? "Save Changes" : "Save EA"}</button>
    </section>
  );
}
