import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CheckCircle2, MessageCircle, Send, Loader2, Bot, Zap, ShieldCheck, Clock, KeyRound, Sparkles, ArrowRight,
  Menu, X, Rocket, TrendingUp, Headphones, Target, Signal, Wifi, BatteryFull, Radar, ChevronDown, Activity,
} from "lucide-react";
import { TradingHomePreview } from "@/components/LandingPhoneMockup";
import { getPublicPromoSite, recordPromoView, submitPromoLead } from "@/lib/promo-site.functions";
import {
  PROMO_ACCENTS, countdownParts, getBotMessage, initials, isPromoAccent, isValidSlug, miniCandles, parseBenefit,
  splitTitle, telegramLink, whatsappLink, type Countdown,
} from "@/lib/promo-site";

export const Route = createFileRoute("/site/$slug")({
  loader: async ({ params }) => {
    if (!isValidSlug(params.slug)) throw notFound();
    const site = await getPublicPromoSite({ data: { slug: params.slug } });
    if (!site) throw notFound();
    return { site };
  },
  head: ({ loaderData }) => {
    const s = loaderData?.site;
    if (!s) {
      return { meta: [{ title: "Unavailable — Algo Vault EA" }, { name: "robots", content: "noindex" }] };
    }
    const desc = (s.tagline || s.headline || s.description || `Discover ${s.bot_name}`).slice(0, 160);
    return {
      meta: [
        { title: `${s.bot_name} — Trading Bot` },
        { name: "description", content: desc },
        { property: "og:title", content: s.headline || s.bot_name },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="promo-site min-h-screen grid place-items-center px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">This page isn't available</h1>
        <p className="mt-2 opacity-70">The link may be wrong, or the owner has hidden it.</p>
      </div>
    </div>
  ),
  component: PromoSite,
});

type Site = ReturnType<typeof Route.useLoaderData>["site"];

const BENEFIT_ICONS = [ShieldCheck, Rocket, TrendingUp, Headphones, Zap, Clock, Target, Sparkles];
const DEFAULT_BENEFITS = [
  "Fully automated: The bot watches the market and trades for you.",
  "Emotion-free: Fixed rules — no panic, no greed.",
  "Saves your time: Set it up once and let it work 24/5.",
  "Direct support: Reach the mentor on WhatsApp whenever you need help.",
];
const TICKER = ["Fully automated", "Runs 24/5", "Emotion-free", "Licence key access", "Hands-free trading", "Direct mentor support"];
const NAV = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "benefits", label: "Benefits" },
  { id: "offer", label: "Offer" },
  { id: "contact", label: "Contact" },
];

/** Ticks every second after the page has loaded (null on the server). */
function useNow(enabled: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

/** Fades sections in as they scroll into view; content stays visible without it. */
function useReveal() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    root.classList.add("promo-reveal-ready");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { threshold: 0.12 });
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

function PromoSite() {
  const { site } = Route.useLoaderData();
  const accent = PROMO_ACCENTS[isPromoAccent(site.accent) ? site.accent : "azure"];
  const wa = whatsappLink(site.whatsapp, getBotMessage(site.bot_name));
  const tg = telegramLink(site.telegram);
  const cta = site.cta_label || "Get this bot";
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useReveal();
  const now = useNow(!!site.offer_ends_at);
  const countdown = now === null ? null : countdownParts(site.offer_ends_at, now);
  const hasOffer = !!(site.price_text || site.old_price || site.offer_percent > 0);
  const title = splitTitle(site.bot_name);

  useEffect(() => {
    const key = `promo.viewed.${site.slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* noop */ }
    recordPromoView({ data: { slug: site.slug } }).catch(() => {});
  }, [site.slug]);

  const style = { "--promo": accent.main, "--promo-glow": accent.glow } as CSSProperties;
  const ctaHref = wa ?? "#contact";
  const ext = wa ? { target: "_blank", rel: "noreferrer" } : {};
  const benefits = (site.features.length ? site.features : DEFAULT_BENEFITS).map(parseBenefit);
  const nav = NAV.filter((n) => n.id !== "offer" || hasOffer);

  return (
    <div ref={rootRef} id="home" className="promo-site min-h-screen" style={style}>
      {/* Top bar */}
      <nav className="promo-nav sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <a href="#home" className="flex items-center gap-3 min-w-0">
            <Logo site={site} className="size-10" />
            <span className="truncate font-extrabold tracking-wide">{site.bot_name}</span>
          </a>
          <div className="hidden md:flex items-center gap-7">
            {nav.map((n) => (
              <a key={n.id} href={`#${n.id}`} className="promo-nav-link text-xs font-bold uppercase tracking-[0.2em]">{n.label}</a>
            ))}
          </div>
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className="md:hidden size-10 grid place-items-center rounded-xl" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen}>
            {menuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="promo-menu md:hidden px-5 pb-4">
            {nav.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={() => setMenuOpen(false)} className="block py-3 text-sm font-bold uppercase tracking-[0.2em]">{n.label}</a>
            ))}
          </div>
        )}
      </nav>

      {/* Hero */}
      <header className="promo-hero relative overflow-hidden">
        <div className="promo-grid" aria-hidden />
        <div className="promo-orb promo-orb-a" aria-hidden />
        <div className="promo-orb promo-orb-b" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pt-12 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
          <div>
            <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">Automated trading system</p>
            <h1 className="mt-5 text-[46px] sm:text-7xl font-black uppercase leading-[0.95] tracking-tight">
              <span className="block">{title.lead}</span>
              {title.tail && <span className="promo-tail block">{title.tail}</span>}
            </h1>
            {site.headline && <p className="mt-6 text-xl sm:text-2xl font-semibold">{site.headline}</p>}
            {site.tagline && <p className="mt-2 text-base opacity-70">{site.tagline}</p>}
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a href={ctaHref} {...ext} className="promo-cta promo-cta-big rounded-full px-8 py-4 text-base font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-2">
                {wa && <MessageCircle className="size-5" />} {cta} <ArrowRight className="size-5" />
              </a>
              <a href={hasOffer ? "#offer" : "#about"} className="promo-ghost rounded-full px-7 py-4 font-bold inline-flex items-center justify-center gap-2">
                {hasOffer ? "See the offer" : "Learn more"}
              </a>
            </div>
          </div>
          <div className="relative mx-auto">
            <PhoneMockup site={site} />
            <span className="promo-chip promo-chip-a hidden sm:inline-flex"><Zap className="size-4" /> Hands-free 24/5</span>
            <span className="promo-chip promo-chip-b hidden sm:inline-flex"><Radar className="size-4" /> Setup found</span>
          </div>
        </div>
      </header>

      {/* Ticker */}
      <div className="promo-ticker overflow-hidden py-4" aria-hidden>
        <div className="promo-ticker-track flex w-max gap-10">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="inline-flex items-center gap-3 text-sm font-bold uppercase tracking-[0.2em] whitespace-nowrap">
              <Sparkles className="size-4 promo-accent-text" /> {t}
            </span>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6">
        {/* About + offer */}
        <section id="about" className="scroll-mt-20 grid gap-10 py-20 lg:grid-cols-2 lg:items-start">
          <div data-reveal>
            <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">About the system</p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-black uppercase leading-tight">
              {title.lead} {title.tail && <span className="promo-tail">{title.tail}</span>}
            </h2>
            <div className="mt-6 space-y-4 leading-relaxed opacity-80 whitespace-pre-wrap">
              {site.description
                ? <p><b className="opacity-100">{site.bot_name}</b> {site.description.replace(new RegExp(`^${escapeRe(site.bot_name)}\\s*`, "i"), "")}</p>
                : <p><b>{site.bot_name}</b> follows clear trading rules and places trades for you automatically — no charts to watch, no emotions in the way.</p>}
            </div>
            {site.stat_text && <StatPill text={site.stat_text} className="mt-7" />}
          </div>
          {hasOffer ? (
            <OfferCard id="offer" site={site} countdown={countdown} wa={wa} cta={cta} />
          ) : (
            <div data-reveal className="promo-card rounded-3xl p-7">
              <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">Get started</p>
              <p className="mt-3 text-2xl font-black">Talk to the mentor today</p>
              <p className="mt-2 opacity-70">Get your licence key and help setting up.</p>
              <a href={ctaHref} {...ext} className="promo-wa mt-6 flex items-center justify-center gap-2 rounded-full px-6 py-4 font-extrabold uppercase tracking-wider">
                <MessageCircle className="size-5" /> {wa ? "Chat on WhatsApp" : "Leave my details"}
              </a>
            </div>
          )}
        </section>

        {/* Benefits */}
        <section id="benefits" className="scroll-mt-20 py-12">
          <div data-reveal className="text-center">
            <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">Benefits</p>
            <h2 className="mt-3 text-3xl sm:text-5xl font-black">Why traders choose it</h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b, i) => {
              const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
              return (
                <div key={`${b.title}-${i}`} data-reveal style={{ transitionDelay: `${(i % 4) * 80}ms` }} className="promo-card promo-lift rounded-3xl p-6">
                  <span className="promo-icon-solid size-12 rounded-2xl grid place-items-center"><Icon className="size-6" /></span>
                  <p className="mt-5 text-lg font-bold">{b.title}</p>
                  {b.text && <p className="mt-2 text-sm opacity-65 leading-relaxed">{b.text}</p>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Inside the bot */}
        <section className="grid gap-12 py-20 lg:grid-cols-2 lg:items-center">
          <div data-reveal className="order-2 lg:order-1 mx-auto">
            <LogPhone site={site} />
          </div>
          <div data-reveal className="order-1 lg:order-2">
            <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">See it in action</p>
            <h2 className="mt-3 text-3xl sm:text-5xl font-black leading-tight">It works while <span className="promo-tail">you live</span></h2>
            <p className="mt-4 opacity-70 leading-relaxed">{site.bot_name} scans the market, waits for its setup and places the trade with a stop loss and target — all on its own.</p>
            <ul className="mt-7 space-y-4">
              {[
                { icon: <Radar className="size-5" />, t: "Scans the market for you", d: "No more staring at charts all day." },
                { icon: <Target className="size-5" />, t: "Trades only its setups", d: "Fixed rules, the same way every time." },
                { icon: <ShieldCheck className="size-5" />, t: "Protects every trade", d: "Each order goes in with a stop loss." },
              ].map((x) => (
                <li key={x.t} className="flex gap-4">
                  <span className="promo-icon size-11 shrink-0 rounded-xl grid place-items-center">{x.icon}</span>
                  <div><p className="font-bold">{x.t}</p><p className="text-sm opacity-65">{x.d}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section className="py-12">
          <div data-reveal className="text-center">
            <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">How it works</p>
            <h2 className="mt-3 text-3xl sm:text-5xl font-black">Start in 3 easy steps</h2>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { icon: <MessageCircle className="size-5" />, title: `Tap "${cta}"`, text: wa ? "WhatsApp opens a chat with the mentor straight away." : "Leave your details and we'll contact you." },
              { icon: <KeyRound className="size-5" />, title: "Get your licence key", text: "We set you up and send your personal key." },
              { icon: <Zap className="size-5" />, title: "Let the bot trade", text: "Connect your account and switch the bot on." },
            ].map((s, i) => (
              <li key={s.title} data-reveal style={{ transitionDelay: `${i * 90}ms` }} className="promo-step relative rounded-3xl p-6">
                <span className="promo-step-big absolute right-5 top-3 text-6xl font-black" aria-hidden>{i + 1}</span>
                <span className="promo-step-num size-12 rounded-2xl grid place-items-center">{s.icon}</span>
                <p className="mt-5 text-lg font-bold">{s.title}</p>
                <p className="mt-1 text-sm opacity-65">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl py-20">
          <div data-reveal className="text-center">
            <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">Questions</p>
            <h2 className="mt-3 text-3xl sm:text-5xl font-black">Good to know</h2>
          </div>
          <div className="mt-10 space-y-3">
            {[
              { q: "Do I need trading experience?", a: `No. Once ${site.bot_name} is set up it trades on its own, and the mentor helps you get started.` },
              { q: "How do I get the bot?", a: wa ? `Tap "${cta}" to chat on WhatsApp. You'll receive your licence key and setup help.` : "Leave your details below and the mentor will contact you with your licence key." },
              { q: "Is profit guaranteed?", a: "No. Trading always carries risk. The bot follows fixed rules, but no result can be promised." },
              { q: "Can I get help later?", a: "Yes — message the mentor any time you need support." },
            ].map((f) => (
              <details key={f.q} data-reveal className="promo-faq group rounded-2xl px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold">
                  {f.q} <ChevronDown className="size-5 shrink-0 transition group-open:rotate-180 promo-accent-text" />
                </summary>
                <p className="mt-3 text-sm opacity-70 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final call */}
        {wa && (
          <section data-reveal className="promo-final relative overflow-hidden rounded-[32px] p-8 sm:p-12 text-center">
            <div className="promo-orb promo-orb-c" aria-hidden />
            <div className="relative">
              <h2 className="text-3xl sm:text-5xl font-black uppercase leading-tight">Ready to start?</h2>
              <p className="mt-3 opacity-80">Chat with the mentor on WhatsApp and get {site.bot_name} today.</p>
              <a href={wa} target="_blank" rel="noreferrer" className="promo-wa mt-7 inline-flex items-center justify-center gap-2 rounded-full px-9 py-4 text-base font-extrabold uppercase tracking-wider">
                <MessageCircle className="size-5" /> {cta}
              </a>
            </div>
          </section>
        )}

        <div className="mx-auto max-w-2xl py-20">
          <LeadForm slug={site.slug} botName={site.bot_name} />
          {tg && (
            <div className="mt-6 flex justify-center">
              <a href={tg} target="_blank" rel="noreferrer" className="promo-ghost rounded-full px-5 py-3 text-sm font-semibold inline-flex items-center gap-2"><Send className="size-4" /> Join us on Telegram</a>
            </div>
          )}
        </div>
      </main>

      <footer className="promo-footer px-6 py-8 text-center text-sm">
        <p className="opacity-60">© {new Date().getFullYear()} {site.bot_name}. Trade responsibly — trading involves risk.</p>
        <p className="mt-2 font-bold tracking-wider opacity-80">Powered by <span className="promo-accent-text">Algo Vault EA</span></p>
      </footer>

      {/* Floating WhatsApp */}
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp" className="promo-fab fixed bottom-5 right-5 z-50 size-16 rounded-full grid place-items-center">
          <MessageCircle className="size-8" />
        </a>
      )}
    </div>
  );
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Logo({ site, className = "" }: { site: Site; className?: string }) {
  return (
    <span className={`promo-logo shrink-0 rounded-full overflow-hidden grid place-items-center text-sm font-black ${className}`}>
      {site.image ? <img src={site.image} alt="" className="size-full object-cover" /> : initials(site.bot_name)}
    </span>
  );
}

function StatPill({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`promo-stat inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-extrabold ${className}`}>
      <TrendingUp className="size-4" /> {text}
    </span>
  );
}

function OfferCard({ id, site, countdown, wa, cta }: { id: string; site: Site; countdown: Countdown | null; wa: string | null; cta: string }) {
  const buyHref = wa ?? "#contact";
  const ext = wa ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <div id={id} data-reveal className="promo-offer scroll-mt-24 relative overflow-hidden rounded-[28px] p-7 text-center">
      <div className="promo-offer-glow" aria-hidden />
      <div className="relative">
        <p className="promo-kicker text-xs font-bold uppercase tracking-[0.3em]">Hands-free trading</p>
        <p className="mt-4 text-5xl sm:text-6xl font-black leading-none">
          {site.offer_percent > 0
            ? <><span className="promo-tail">{site.offer_percent}%</span> Off</>
            : <>Get it <span className="promo-tail">today</span></>}
        </p>
        <p className="mt-3 opacity-60">{countdown ? "Special limited offer" : "Limited spots available"}</p>
        {countdown && (
          <div className="mt-6 grid grid-cols-4 gap-2 sm:gap-3" aria-label="Time left on this offer">
            {([["Days", countdown.days], ["Hrs", countdown.hours], ["Mins", countdown.mins], ["Secs", countdown.secs]] as const).map(([l, v]) => (
              <div key={l}>
                <div className="promo-count rounded-2xl py-3 text-2xl sm:text-3xl font-black tabular-nums">{String(v).padStart(2, "0")}</div>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] opacity-50">{l}</p>
              </div>
            ))}
          </div>
        )}
        <a href={buyHref} {...ext} className="promo-cta mt-7 flex items-center justify-center gap-2 rounded-full px-6 py-4 font-extrabold uppercase tracking-wider">
          {site.price_text ? `Buy now — ${site.price_text}` : cta}
        </a>
        {site.old_price && (
          <p className="mt-4 text-sm">
            <span className="opacity-60">Normal price </span>
            <s className="opacity-50">{site.old_price}</s>
            {site.price_text && <> <span className="promo-accent-text font-bold">now {site.price_text}</span></>}
          </p>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="promo-wa mt-5 flex items-center justify-center gap-2 rounded-full px-6 py-4 font-extrabold uppercase tracking-wider">
            <MessageCircle className="size-5" /> Chat on WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

function PhoneFrame({ children, tilt = "" }: { children: ReactNode; tilt?: string }) {
  return (
    <div className={`promo-phone relative w-[270px] sm:w-[300px] aspect-[9/19] rounded-[44px] p-[10px] ${tilt}`}>
      <div className="promo-phone-btn promo-phone-btn-a" aria-hidden />
      <div className="promo-phone-btn promo-phone-btn-b" aria-hidden />
      <div className="promo-screen relative size-full overflow-hidden rounded-[36px]">
        <div className="promo-island absolute left-1/2 top-2.5 z-10 h-6 w-24 -translate-x-1/2 rounded-full" aria-hidden />
        <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-bold">
          <span>9:41</span>
          <span className="flex items-center gap-1"><Signal className="size-3" /><Wifi className="size-3" /><BatteryFull className="size-3.5" /></span>
        </div>
        {children}
      </div>
    </div>
  );
}

function PhoneMockup({ site }: { site: Site }) {
  if (site.phone_interface) {
    return (
      <div className="promo-phone-float" aria-label={`${site.bot_name} app preview`} role="img">
        <PhoneFrame tilt="promo-tilt">
          <div className="absolute inset-x-0 bottom-0 top-8 overflow-hidden"><TradingHomePreview skinId={site.phone_interface} name={site.bot_name} image={site.image} /></div>
        </PhoneFrame>
      </div>
    );
  }
  const candles = miniCandles(site.slug);
  const w = 220, h = 110, cw = w / candles.length;
  const lo = Math.min(...candles.map((c) => c.l)), hi = Math.max(...candles.map((c) => c.h));
  const y = (v: number) => 6 + (1 - (v - lo) / Math.max(1, hi - lo)) * (h - 12);
  return (
    <div className="promo-phone-float" aria-label={`${site.bot_name} app preview`} role="img">
      <PhoneFrame tilt="promo-tilt">
        <div className="px-4 pt-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Logo site={site} className="size-9 text-[11px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold">{site.bot_name}</p>
              <p className="flex items-center gap-1.5 text-[10px] font-bold promo-ok"><span className="promo-live-dot size-1.5 rounded-full" /> Running</p>
            </div>
            <Bot className="size-5 promo-accent-text" />
          </div>

          <div className="promo-screen-card rounded-2xl p-3">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider opacity-70">
              <span>Live market scan</span><Activity className="size-3.5 promo-accent-text" />
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" aria-hidden>
              {candles.map((c, i) => {
                const up = c.c >= c.o;
                const x = i * cw + cw / 2;
                return (
                  <g key={i} className={up ? "promo-candle-up" : "promo-candle-down"}>
                    <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} strokeWidth={1} />
                    <rect x={x - cw * 0.3} width={cw * 0.6} y={y(Math.max(c.o, c.c))} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} rx={1} />
                  </g>
                );
              })}
              <line className="promo-scanline" x1={0} x2={0} y1={0} y2={h} strokeWidth={2} />
            </svg>
          </div>

          <div className="promo-screen-card rounded-2xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Signal</span>
              <span className="promo-buy rounded-md px-2 py-0.5 text-[10px] font-black">BUY</span>
            </div>
            <p className="mt-1.5 text-sm font-extrabold">Setup confirmed</p>
            <p className="text-[10px] opacity-60">Stop loss &amp; target set automatically</p>
            <div className="promo-bar mt-2.5 h-1.5 rounded-full overflow-hidden"><span className="block h-full rounded-full" /></div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="promo-screen-card rounded-xl p-2.5"><p className="text-[9px] uppercase tracking-wider opacity-60">Mode</p><p className="text-xs font-extrabold">Auto</p></div>
            <div className="promo-screen-card rounded-xl p-2.5"><p className="text-[9px] uppercase tracking-wider opacity-60">Hours</p><p className="text-xs font-extrabold">24/5</p></div>
          </div>

          <div className="promo-screen-card rounded-2xl p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Recent activity</p>
            {["Trend confirmed", "Order protected", "Next scan running"].map((t) => (
              <p key={t} className="flex items-center gap-2 text-[11px]"><CheckCircle2 className="size-3.5 promo-ok" /> {t}</p>
            ))}
          </div>

          <div className="promo-cta rounded-full py-2.5 text-center text-xs font-black uppercase tracking-widest">Bot is ON</div>
        </div>
      </PhoneFrame>
    </div>
  );
}

function LogPhone({ site }: { site: Site }) {
  const lines = [
    { t: "09:41", m: "Scanning the market…" },
    { t: "09:42", m: "Trend confirmed" },
    { t: "09:42", m: "Entry setup found" },
    { t: "09:42", m: "Order sent with stop loss" },
    { t: "09:43", m: "Target set — managing trade" },
    { t: "09:58", m: "Waiting for the next setup" },
  ];
  return (
    <div role="img" aria-label={`${site.bot_name} trade log preview`}>
      <PhoneFrame tilt="promo-tilt-r">
        <div className="px-4 pt-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold">Trade Log</p>
            <span className="promo-buy rounded-md px-2 py-0.5 text-[10px] font-black">LIVE</span>
          </div>
          <div className="mt-4 space-y-2 font-mono">
            {lines.map((l, i) => (
              <div key={i} className="promo-log-line promo-screen-card rounded-xl px-3 py-2.5 text-[11px]" style={{ animationDelay: `${i * 0.9}s` }}>
                <span className="promo-accent-text font-bold">{l.t}</span> <span className="opacity-90">{l.m}</span>
              </div>
            ))}
          </div>
        </div>
      </PhoneFrame>
    </div>
  );
}

function LeadForm({ slug, botName }: { slug: string; botName: string }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim() || contact.trim().length < 3) { setErr("Please add your name and a WhatsApp number or email."); return; }
    setBusy(true);
    try {
      const res = await submitPromoLead({ data: { slug, name, contact, message } });
      if (res.ok) setDone(true); else setErr(res.error ?? "Could not send. Please try again.");
    } catch {
      setErr("Could not send. Please try again.");
    }
    setBusy(false);
  }

  return (
    <section id="contact" data-reveal className="promo-form rounded-[28px] p-6 sm:p-8 scroll-mt-20">
      {done ? (
        <div className="text-center py-6">
          <CheckCircle2 className="mx-auto size-14 promo-accent-text" />
          <h2 className="mt-4 text-2xl font-black">Thank you!</h2>
          <p className="mt-2 opacity-70">The {botName} team will contact you soon.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <p className="promo-kicker text-xs font-bold tracking-[0.3em] uppercase">Contact</p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-black">Leave your details</h2>
            <p className="mt-1 text-sm opacity-70">The mentor will get back to you as soon as possible.</p>
          </div>
          <input className="promo-input w-full rounded-xl px-4 py-3.5" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          <input className="promo-input w-full rounded-xl px-4 py-3.5" placeholder="WhatsApp number (e.g. +27…) or email" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} required />
          <textarea className="promo-input w-full rounded-xl px-4 py-3.5" rows={3} placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
          {err && <p className="text-sm promo-accent-text">{err}</p>}
          <button type="submit" disabled={busy} className="promo-cta w-full rounded-full px-6 py-4 font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />} Send my details
          </button>
        </form>
      )}
    </section>
  );
}
