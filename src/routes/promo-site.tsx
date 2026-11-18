import { createFileRoute, Link } from "@tanstack/react-router";
import { MAIN_INTERFACES } from "@/lib/portal-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Menu, Globe, Plus, Trash2, Copy, ExternalLink, Eye, Loader2, ImagePlus, X, Check,
  MessageCircle, Sparkles, Bot, Palette, Type, Rocket, Upload, Pencil, Users, Tag,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { MentorSidebar } from "@/components/MentorSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePortalStore } from "@/lib/portal-store";
import {
  PROMO_ACCENTS, clampDiscount, getBotMessage, isValidSlug, parseFeatures, slugify, whatsappLink, whatsappProblem,
  type PromoAccent,
} from "@/lib/promo-site";
import botLogo from "@/assets/bot-logo.jpg";

export const Route = createFileRoute("/promo-site")({
  head: () => ({
    meta: [
      { title: "Promo Website — Algo Vault EA Mentor" },
      { name: "description", content: "Build a public promotion website for your trading bot and share the link with clients." },
      { property: "og:title", content: "Bot Promo Website Builder — Algo Vault EA" },
      { property: "og:description", content: "Mentors create a shareable promotion page for their trading bot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AuthGate>
      <PromoSitePage />
    </AuthGate>
  ),
});

type SiteRow = {
  id: string;
  slug: string;
  bot_name: string;
  headline: string;
  tagline: string;
  description: string;
  features: string[];
  price_text: string;
  whatsapp: string;
  telegram: string;
  cta_label: string;
  image: string | null;
  accent: string;
  published: boolean;
  views: number;
  old_price: string;
  offer_percent: number;
  offer_ends_at: string | null;
  stat_text: string;
  phone_interface: string;
};

type Draft = Omit<SiteRow, "id" | "views" | "features"> & { id?: string; features: string };

const EMPTY: Draft = {
  slug: "", bot_name: "", headline: "", tagline: "", description: "", features: "",
  price_text: "", whatsapp: "", telegram: "", cta_label: "Get this bot", image: null,
  accent: "azure", published: true,
  old_price: "", offer_percent: 0, offer_ends_at: null, stat_text: "", phone_interface: "",
};

/** Database limit for the stored picture (characters of the data URL). */
const IMAGE_LIMIT = 580_000;

/** ISO time → value for a datetime-local box (in the mentor's own time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDraft(r: SiteRow): Draft {
  return { ...r, features: r.features.join("\n") };
}

/** Resize any picture (uploaded file, bot picture or link) to a small JPEG data URL. */
function shrinkSrc(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        let max = 900;
        let out = "";
        for (let i = 0; i < 4; i++) {
          const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", 0.8);
          if (out.length <= IMAGE_LIMIT) break;
          max = Math.round(max * 0.7);
        }
        resolve(out);
      } catch {
        // A linked picture the browser won't let us resize: keep the link itself.
        if (/^https?:/i.test(src) && src.length < 2000) resolve(src);
        else reject(new Error("That picture could not be used. Try another one."));
      }
    };
    img.onerror = () => reject(new Error("That picture could not be opened."));
    img.src = src;
  });
}

function fileToSrc(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That picture could not be opened."));
    r.readAsDataURL(file);
  });
}

function PromoSitePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { session } = useAuth();
  const { eas, profileImage } = usePortalStore();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const restored = useRef(false);

  const userId = session?.user.id ?? null;
  const draftKey = userId ? `promo.draft.${userId}` : null;

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data }, leads] = await Promise.all([
      supabase
        .from("promo_sites")
        .select("id,slug,bot_name,headline,tagline,description,features,price_text,whatsapp,telegram,cta_label,image,accent,published,views,old_price,offer_percent,offer_ends_at,stat_text,phone_interface")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("promo_leads").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    ]);
    setSites((data as SiteRow[] | null) ?? []);
    setLeadCount(leads.count ?? 0);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Bring back an unsaved draft (the phone may reload the page after picking a photo).
  useEffect(() => {
    if (!draftKey || restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const saved = JSON.parse(raw) as { draft: Draft; slugTouched: boolean };
        if (saved?.draft) { setDraft(saved.draft); setSlugTouched(!!saved.slugTouched); }
      }
    } catch { /* ignore broken drafts */ }
  }, [draftKey]);

  // Keep the draft safe while editing.
  useEffect(() => {
    if (!draftKey || !restored.current) return;
    try {
      if (draft) sessionStorage.setItem(draftKey, JSON.stringify({ draft, slugTouched }));
      else sessionStorage.removeItem(draftKey);
    } catch { /* storage full — editing still works */ }
  }, [draft, slugTouched, draftKey]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const siteUrl = (slug: string) => `${origin}/site/${slug}`;
  const lastWhatsapp = sites.find((s) => s.whatsapp)?.whatsapp ?? "";
  const totalViews = sites.reduce((n, s) => n + s.views, 0);

  function openEditor(next: Draft, touched: boolean) {
    setDraft(next);
    setSlugTouched(touched);
    setMsg(null);
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function startNew() {
    const ea = eas[0];
    openEditor({
      ...EMPTY,
      bot_name: ea?.name ?? "",
      slug: ea ? slugify(ea.name) : "",
      whatsapp: lastWhatsapp,
      headline: ea ? `Trade smarter with ${ea.name}` : "",
      tagline: "No emotions. Just money and mission.",
    }, false);
    if (ea?.image) await applyPicture(ea.image);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [key]: value };
      if (key === "bot_name" && !slugTouched && !d.id) next.slug = slugify(String(value));
      return next;
    });
  }

  async function applyPicture(src: string) {
    setImgBusy(true);
    try {
      const small = await shrinkSrc(src);
      setDraft((d) => d && { ...d, image: small });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setImgBusy(false);
  }

  async function pickBot(ea: (typeof eas)[number]) {
    setDraft((d) => d && {
      ...d,
      bot_name: ea.name,
      slug: slugTouched || d.id ? d.slug : slugify(ea.name),
      headline: d.headline || `Trade smarter with ${ea.name}`,
    });
    if (ea.image) await applyPicture(ea.image);
  }

  async function save() {
    if (!draft || !userId) return;
    setMsg(null);
    const slug = draft.slug.trim().toLowerCase();
    if (!draft.bot_name.trim()) return setMsg({ ok: false, text: "Enter your bot name." });
    if (!isValidSlug(slug)) return setMsg({ ok: false, text: "Web address must be 3–40 letters, numbers or dashes (no spaces)." });
    const waIssue = whatsappProblem(draft.whatsapp);
    if (waIssue) return setMsg({ ok: false, text: waIssue });
    if (draft.image && draft.image.length > 600_000) return setMsg({ ok: false, text: "That picture is too big. Choose a smaller one." });
    setBusy(true);
    const payload = {
      slug,
      bot_name: draft.bot_name.trim(),
      headline: draft.headline.trim(),
      tagline: draft.tagline.trim(),
      description: draft.description.trim(),
      features: parseFeatures(draft.features),
      price_text: draft.price_text.trim(),
      whatsapp: draft.whatsapp.trim(),
      telegram: draft.telegram.trim(),
      cta_label: draft.cta_label.trim() || "Get this bot",
      image: draft.image,
      accent: draft.accent,
      published: draft.published,
      old_price: draft.old_price.trim(),
      offer_percent: clampDiscount(Number(draft.offer_percent)),
      offer_ends_at: draft.offer_ends_at,
      phone_interface: draft.phone_interface,
      stat_text: draft.stat_text.trim(),
    };
    const res = draft.id
      ? await supabase.from("promo_sites").update(payload).eq("id", draft.id)
      : await supabase.from("promo_sites").insert({ ...payload, user_id: userId });
    setBusy(false);
    if (res.error) {
      const taken = res.error.code === "23505";
      setMsg({ ok: false, text: taken ? "That web address is already taken. Try another one." : "Could not save. Please try again." });
      return;
    }
    setMsg({ ok: true, text: draft.published ? "Saved — your website is live. Copy the link and share it!" : "Saved as hidden. Switch on 'Live' to share it." });
    setDraft(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this website? Visitors will no longer see it.")) return;
    await supabase.from("promo_sites").delete().eq("id", id);
    if (draft?.id === id) setDraft(null);
    load();
  }

  async function copy(slug: string) {
    try { await navigator.clipboard.writeText(siteUrl(slug)); setCopied(slug); setTimeout(() => setCopied(null), 1500); } catch { /* noop */ }
  }

  const waIssue = draft ? whatsappProblem(draft.whatsapp) : null;
  const waTest = draft ? whatsappLink(draft.whatsapp, getBotMessage(draft.bot_name || "your bot")) : null;
  const pictures = [
    ...eas.filter((e) => e.image).map((e) => ({ key: e.id, label: e.name, src: e.image as string })),
    ...(profileImage ? [{ key: "profile", label: "Profile", src: profileImage }] : []),
  ];

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button onClick={() => setMenuOpen(true)} className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center hover:bg-card transition" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <h1 className="font-display text-lg font-bold">Promo Website</h1>
        <span className="studio-icon-badge size-11 rounded-xl grid place-items-center"><Globe className="size-5" /></span>
      </header>

      <main className="px-5 pt-6 pb-20 space-y-6 max-w-md mx-auto">
        {/* Hero */}
        <section className="studio-hero relative overflow-hidden rounded-[28px] p-6">
          <div className="studio-orb studio-orb-a" aria-hidden />
          <div className="studio-orb studio-orb-b" aria-hidden />
          <div className="relative">
            <span className="studio-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]">
              <Sparkles className="size-3.5" /> Promotion studio
            </span>
            <h2 className="mt-4 font-display text-[28px] leading-tight font-bold">
              Turn your bot into a <span className="studio-gradient-text">money-making website</span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Share one link on WhatsApp, TikTok or Instagram. Visitors tap <b className="text-foreground">Get this bot</b> and land straight in your WhatsApp chat.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Stat icon={<Globe className="size-4" />} value={sites.length} label="Websites" />
              <Stat icon={<Eye className="size-4" />} value={totalViews} label="Visits" />
              <Stat icon={<Users className="size-4" />} value={leadCount} label="Enquiries" />
            </div>
            {!draft && (
              <Button onClick={startNew} className="studio-cta mt-5 w-full h-13 rounded-2xl gap-2 text-base font-bold">
                <Plus className="size-5" /> Create a website
              </Button>
            )}
          </div>
        </section>

        {msg && (
          <p className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${msg.ok ? "border-primary/50 bg-primary/10 text-primary" : "border-destructive/60 bg-destructive/10 text-destructive"}`}>
            {msg.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
            {msg.text}
          </p>
        )}

        {draft && (
          <section ref={editorRef} className="scroll-mt-24 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-bold">{draft.id ? "Edit website" : "New website"}</h3>
              <button onClick={() => setDraft(null)} className="size-9 rounded-full border border-border grid place-items-center text-muted-foreground hover:text-foreground" aria-label="Close editor"><X className="size-4" /></button>
            </div>

            <LivePreview draft={draft} />

            {/* 1. Bot */}
            <Step n={1} icon={<Bot className="size-4" />} title="Your bot">
              {eas.length > 0 && (
                <Field label="Use one of your bots">
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {eas.map((ea) => {
                      const on = draft.bot_name === ea.name;
                      return (
                        <button key={ea.id} type="button" onClick={() => pickBot(ea)}
                          className={`studio-bot-pick shrink-0 flex items-center gap-2 rounded-2xl pl-1.5 pr-3 py-1.5 text-xs font-semibold ${on ? "is-on" : ""}`}>
                          <img src={ea.image || profileImage || botLogo} alt="" className="size-8 rounded-full object-cover" />
                          <span className="max-w-[9rem] truncate">{ea.name}</span>
                          {on && <Check className="size-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
              <Field label="Bot name"><Input value={draft.bot_name} onChange={(e) => set("bot_name", e.target.value)} maxLength={80} placeholder="e.g. Neymar Scalper EA" /></Field>
              <Field label="Bot picture">
                <div className="flex items-center gap-3">
                  <div className="studio-picture size-20 shrink-0 rounded-2xl overflow-hidden grid place-items-center">
                    {imgBusy ? <Loader2 className="size-5 animate-spin text-primary" /> : draft.image ? <img src={draft.image} alt="" className="size-full object-cover" /> : <ImagePlus className="size-6 text-muted-foreground" />}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-primary/40 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10">
                      <Upload className="size-3.5" /> Upload from phone
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                        try { await applyPicture(await fileToSrc(f)); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
                      }} />
                    </label>
                    {draft.image && <button type="button" onClick={() => set("image", null)} className="text-left text-xs text-muted-foreground underline">Remove picture</button>}
                  </div>
                </div>
                {pictures.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[11px] text-muted-foreground">Or tap a picture from your bots:</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {pictures.map((p) => (
                        <button key={p.key} type="button" onClick={() => applyPicture(p.src)} title={p.label}
                          className="studio-thumb shrink-0 size-14 rounded-xl overflow-hidden">
                          <img src={p.src} alt={p.label} className="size-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Field>
            </Step>

            {/* 2. WhatsApp */}
            <Step n={2} icon={<MessageCircle className="size-4" />} title="Your WhatsApp" highlight>
              <p className="-mt-1 text-xs text-muted-foreground">When visitors press <b className="text-foreground">{draft.cta_label || "Get this bot"}</b>, WhatsApp opens a chat with this number.</p>
              <Field label="WhatsApp number (with country code)">
                <Input value={draft.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} maxLength={32} inputMode="tel" placeholder="+27 71 234 5678" />
              </Field>
              {draft.whatsapp.trim() && waIssue && <p className="text-xs text-destructive">{waIssue}</p>}
              {waTest && (
                <a href={waTest} target="_blank" rel="noreferrer" className="studio-wa-test inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold">
                  <Check className="size-3.5" /> Number looks good — tap to test it
                </a>
              )}
              <Field label="Button text"><Input value={draft.cta_label} onChange={(e) => set("cta_label", e.target.value)} maxLength={40} placeholder="Get this bot" /></Field>
              <Field label="Telegram (optional)"><Input value={draft.telegram} onChange={(e) => set("telegram", e.target.value)} maxLength={64} placeholder="@yourchannel" /></Field>
            </Step>

            {/* 3. Words */}
            <Step n={3} icon={<Type className="size-4" />} title="Words that sell">
              <Field label="Headline"><Input value={draft.headline} onChange={(e) => set("headline", e.target.value)} maxLength={140} placeholder="Trade smarter with Neymar Scalper EA" /></Field>
              <Field label="Short tagline"><Input value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={200} placeholder="No emotions. Just money and mission." /></Field>
              <Field label="About your bot"><Textarea value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={3000} rows={5} placeholder="What does it trade, how does it work, who is it for?" /></Field>
              <Field label="Highlights (one per line, up to 8)"><Textarea value={draft.features} onChange={(e) => set("features", e.target.value)} rows={4} placeholder={"Trades Gold and US30\nAutomatic stop loss\nWorks on MT4 and MT5"} /></Field>
              <Field label="Big highlight badge (optional)"><Input value={draft.stat_text} onChange={(e) => set("stat_text", e.target.value)} maxLength={40} placeholder="e.g. 80–90% Accuracy" /></Field>
              <p className="-mt-2 text-[11px] text-muted-foreground">Tip: write highlights as <b className="text-foreground">Title: short text</b>, e.g. "Hands-Free: Runs 24/5 while you sleep".</p>
            </Step>

            {/* 4. Offer */}
            <Step n={4} icon={<Tag className="size-4" />} title="Price & special offer">
              <Field label="Price"><Input value={draft.price_text} onChange={(e) => set("price_text", e.target.value)} maxLength={80} placeholder="e.g. ZAR 150" /></Field>
              <Field label="Normal price, shown crossed out (optional)"><Input value={draft.old_price} onChange={(e) => set("old_price", e.target.value)} maxLength={80} placeholder="e.g. ZAR 300" /></Field>
              <Field label="Discount % (optional)">
                <Input type="number" inputMode="numeric" min={0} max={95} value={draft.offer_percent || ""} onChange={(e) => set("offer_percent", clampDiscount(Number(e.target.value)))} placeholder="e.g. 50" />
              </Field>
              <Field label="Offer ends (shows a countdown)">
                <Input type="datetime-local" value={toLocalInput(draft.offer_ends_at)} onChange={(e) => set("offer_ends_at", fromLocalInput(e.target.value))} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {[1, 3, 7].map((d) => (
                    <button key={d} type="button" onClick={() => set("offer_ends_at", new Date(Date.now() + d * 86_400_000).toISOString())}
                      className="studio-bot-pick rounded-xl px-3 py-1.5 text-xs font-semibold">{d} day{d > 1 ? "s" : ""}</button>
                  ))}
                  {draft.offer_ends_at && <button type="button" onClick={() => set("offer_ends_at", null)} className="text-xs text-muted-foreground underline px-1">No countdown</button>}
                </div>
              </Field>
            </Step>

            {/* 4. Style & address */}
            <Step n={5} icon={<Palette className="size-4" />} title="Style & link">
              <Field label="Colour">
                <div className="flex gap-3">
                  {(Object.keys(PROMO_ACCENTS) as PromoAccent[]).map((k) => (
                    <button key={k} type="button" aria-label={PROMO_ACCENTS[k].label} onClick={() => set("accent", k)}
                      className={`studio-swatch size-10 rounded-full grid place-items-center ${draft.accent === k ? "is-on" : ""}`}
                      style={{ background: `linear-gradient(135deg, ${PROMO_ACCENTS[k].main}, ${PROMO_ACCENTS[k].glow})`, color: PROMO_ACCENTS[k].main }}>
                      {draft.accent === k && <Check className="size-4 text-primary-foreground" />}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Phone design">
                <div className="grid grid-cols-3 gap-2">
                  {[{ id: "", label: "Classic" }, ...MAIN_INTERFACES].map((m) => (
                    <button key={m.id || "classic"} type="button" onClick={() => set("phone_interface", m.id)}
                      className={`rounded-xl border px-2 py-2 text-xs font-semibold ${draft.phone_interface === m.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/50"}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">The phone on your website shows this trading app home screen.</p>
              </Field>
              <Field label="Web address">
                <div className="flex items-center rounded-md border border-input bg-background/60 pl-3 text-sm">
                  <span className="text-muted-foreground whitespace-nowrap">/site/</span>
                  <input value={draft.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }} maxLength={40}
                    className="h-10 w-full bg-transparent px-1 outline-none" placeholder="neymar-scalper" />
                </div>
              </Field>
              <div className="flex items-center justify-between rounded-2xl border border-border bg-background/40 px-4 py-3">
                <div>
                  <p className="font-medium">Live</p>
                  <p className="text-xs text-muted-foreground">When off, nobody can open the website.</p>
                </div>
                <Switch checked={draft.published} onCheckedChange={(v) => set("published", v)} />
              </div>
            </Step>

            <Button onClick={save} disabled={busy || imgBusy} className="studio-cta w-full h-13 rounded-2xl gap-2 text-base font-bold">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Rocket className="size-5" />} {draft.id ? "Save changes" : "Publish website"}
            </Button>
          </section>
        )}

        <section className="space-y-3">
          <p className="text-xs font-bold tracking-[0.25em] text-muted-foreground uppercase">Your websites</p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sites.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-primary/30 p-6 text-center">
              <Globe className="mx-auto size-8 text-primary/70" />
              <p className="mt-2 text-sm text-muted-foreground">No websites yet. Create your first one above.</p>
            </div>
          ) : (
            sites.map((s) => {
              const a = PROMO_ACCENTS[(s.accent in PROMO_ACCENTS ? s.accent : "azure") as PromoAccent];
              return (
                <article key={s.id} className="studio-site-card relative overflow-hidden rounded-3xl"
                  style={{ ["--site-accent" as string]: a.main, ["--site-glow" as string]: a.glow }}>
                  <div className="studio-site-banner relative h-24">
                    <span className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.published ? "studio-live" : "bg-muted text-muted-foreground"}`}>
                      {s.published && <span className="studio-live-dot size-1.5 rounded-full" />}{s.published ? "Live" : "Hidden"}
                    </span>
                  </div>
                  <div className="px-4 pb-4">
                    <div className="-mt-10 flex items-end gap-3">
                      <div className="studio-site-avatar size-20 shrink-0 rounded-2xl overflow-hidden grid place-items-center">
                        {s.image ? <img src={s.image} alt="" className="size-full object-cover" /> : <Bot className="size-7 text-primary" />}
                      </div>
                      <div className="min-w-0 flex-1 pb-1">
                        <p className="font-display text-lg font-bold truncate">{s.bot_name}</p>
                        <p className="text-xs text-muted-foreground truncate">/site/{s.slug}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Eye className="size-3.5" /> {s.views} visit{s.views === 1 ? "" : "s"}</span>
                      <span className={`inline-flex items-center gap-1 ${s.whatsapp ? "text-primary" : "text-destructive"}`}>
                        <MessageCircle className="size-3.5" /> {s.whatsapp ? "WhatsApp on" : "No WhatsApp"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <Button variant="outline" size="sm" className="rounded-xl gap-1" onClick={() => openEditor(toDraft(s), true)}><Pencil className="size-3.5" />Edit</Button>
                      <Button variant="outline" size="sm" className="rounded-xl gap-1" onClick={() => copy(s.slug)}>{copied === s.slug ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied === s.slug ? "Done" : "Link"}</Button>
                      <Button variant="outline" size="sm" className="rounded-xl gap-1" asChild>
                        <a href={`/site/${s.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" />Open</a>
                      </Button>
                      <Button variant="outline" size="sm" className="rounded-xl" aria-label="Delete website" onClick={() => remove(s.id)}><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}

function LivePreview({ draft }: { draft: Draft }) {
  const a = PROMO_ACCENTS[(draft.accent in PROMO_ACCENTS ? draft.accent : "azure") as PromoAccent];
  return (
    <div className="studio-preview relative overflow-hidden rounded-3xl p-5 text-center"
      style={{ ["--site-accent" as string]: a.main, ["--site-glow" as string]: a.glow }}>
      <p className="absolute left-4 top-3 text-[10px] font-bold uppercase tracking-[0.25em] opacity-60">Live preview</p>
      <div className="studio-preview-portrait mx-auto mt-4 size-24 rounded-full overflow-hidden grid place-items-center">
        {draft.image ? <img src={draft.image} alt="" className="size-full object-cover" /> : <Bot className="size-9" style={{ color: a.glow }} />}
      </div>
      <p className="mt-4 font-display text-2xl font-black uppercase leading-tight studio-preview-title">{draft.bot_name || "Your bot name"}</p>
      <p className="mt-1 text-sm opacity-80">{draft.headline || "Your headline"}</p>
      <span className="studio-preview-cta mt-4 inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold">
        <MessageCircle className="size-4" /> {draft.cta_label || "Get this bot"}
      </span>
      {draft.price_text && <p className="mt-3 text-xs opacity-70">{draft.price_text}</p>}
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="studio-stat rounded-2xl px-3 py-3">
      <span className="text-primary">{icon}</span>
      <p className="mt-1 font-display text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Step({ n, icon, title, highlight, children }: { n: number; icon: React.ReactNode; title: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`studio-step rounded-3xl p-5 space-y-4 ${highlight ? "is-highlight" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="studio-step-num size-8 rounded-full grid place-items-center text-sm font-bold">{n}</span>
        <h4 className="font-display text-base font-bold flex items-center gap-2">{icon}{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-bold tracking-wider uppercase text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
