import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ChartNoAxesCombined, Check, Cloud, Cpu, Download, Menu, Radio, ShieldCheck, Smartphone, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApkDownload } from "@/lib/app-file.functions";
import { LandingPhoneMockup } from "@/components/LandingPhoneMockup";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Algo Vault — Mobile EA Trading & Bot Hosting" },
    { name: "description", content: "Keep your trading world connected with Algo Vault. Access expert advisors, AI chart scanning and MT4 or MT5 from your phone." },
    { property: "og:title", content: "Algo Vault — Mobile EA Trading & Bot Hosting" },
    { property: "og:description", content: "Your robots. Your broker. Your phone. Discover mobile EA trading and chart analysis with Algo Vault." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Landing,
});

function Landing() {
  const [menu, setMenu] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");
  async function download() {
    setDownloading(true); setNotice("");
    try {
      const result = await getApkDownload();
      if (result.url) window.location.assign(result.url);
      else setNotice("The Android download is not available yet. You can open the trading app instead.");
    } catch { setNotice("Download unavailable. Please try again or open the trading app."); }
    finally { setDownloading(false); }
  }
  return <div className="vault-landing min-h-screen bg-background text-foreground">
    <header className="vault-header">
      <div className="vault-container flex items-center justify-between gap-4">
        <Link to="/" className="vault-brand"><Zap aria-hidden="true" /><span>Algo<span className="vault-brand-accent">Vault</span></span></Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground" aria-label="Main navigation">
          <a href="#platform">Features</a><a href="#pricing">Pricing</a><a href="#how-it-works">How it works</a>
        </nav>
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link to="/login">Sign in</Link></Button>
          <Button asChild className="vault-neon hidden sm:inline-flex"><Link to="/ios">Open app <ArrowRight /></Link></Button>
          <Button variant="outline" size="icon" className="md:hidden" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</Button>
        </div>
      </div>
      {menu && <nav className="vault-mobile-menu vault-container" aria-label="Mobile navigation">
        <a href="#platform" onClick={() => setMenu(false)}>Features</a><a href="#pricing" onClick={() => setMenu(false)}>Pricing</a><a href="#how-it-works" onClick={() => setMenu(false)}>How it works</a>
        <Link to="/login">Sign in</Link><Button asChild className="vault-neon"><Link to="/ios">Open trading app <ArrowRight /></Link></Button>
      </nav>}
    </header>
    <main>
      <section className="vault-hero">
        <div className="vault-container vault-hero-content">
          <p className="vault-eyebrow"><span /> MOBILE EA HOSTING · YOUR EDGE, CONNECTED</p>
          <h1>Algo Vault<span>Your robots.<br />Always within reach.</span></h1>
          <p className="vault-hero-copy">Your Expert Advisors, right in your pocket. Connect, start and monitor your trading robots from your phone — with your own broker.</p>
          <div className="vault-hero-actions">
            <Button size="lg" className="vault-neon" onClick={download} disabled={downloading}><Download />{downloading ? "Preparing download…" : "Get Android App"}</Button>
            <Button asChild variant="outline" size="lg" className="vault-outline"><Link to="/ios"><Smartphone />Get iPhone App</Link></Button>
          </div>
          {notice && <p className="vault-download-notice" role="status">{notice}</p>}
          <p className="vault-mentor-link">Are you a mentor? <Link to="/signup">Sign up here <ArrowRight /></Link></p>
          <figure className="vault-phone-stage" aria-label="Algo Vault EA in Interface 5 with blue accents">
            <div className="vault-phone-left"><LandingPhoneMockup secondary /></div>
            <div className="vault-phone-center"><LandingPhoneMockup /></div>
            <div className="vault-phone-right"><LandingPhoneMockup secondary /></div>
            <figcaption className="vault-preview-label"><span /> Algo Vault EA · Interface 5</figcaption>
          </figure>
        </div>
      </section>
      <div className="vault-platform-strip"><div className="vault-ticker">{["AI chart scanner", "Auto trade execution", "Multi-broker support", "MT4 & MT5 connect", "Live signals", "Android & iPhone", "SL / TP sync"].map(text => <span key={text}>{text}<span aria-hidden="true">✦</span></span>)}</div></div>
      <div className="vault-stats vault-container"><div><strong>MT4 / MT5</strong><span>Broker connection</span></div><div><strong>R399.99</strong><span>Lifetime app access</span></div><div><strong>Mobile</strong><span>Android & iPhone</span></div><div><strong>Your EA</strong><span>Your trading world</span></div></div>
      <section id="platform" className="vault-section vault-container">
        <div className="vault-section-heading"><p className="vault-eyebrow">WHY ALGO VAULT</p><h2>Built for your next move.</h2><p>Your trading essentials. One connected platform.</p></div>
        <div className="vault-feature-grid">
          {[
            { icon: Zap, number: "01", title: "Connected execution", text: "Connect your expert advisor to your broker account and follow its trade activity." },
            { icon: ShieldCheck, number: "02", title: "Protected access", text: "Manage your robot with licence keys and protected account access." },
            { icon: Cloud, number: "03", title: "Mobile hosting", text: "Keep your expert advisors within reach without staying at your desktop." },
            { icon: ChartNoAxesCombined, number: "04", title: "AI chart scanner", text: "Analyze market structure, momentum and liquidity with live chart scanning." },
          ].map(({ icon: Icon, number, title, text }) => <article className="vault-feature" key={number}><div className="flex justify-between items-center"><Icon /><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article>)}
        </div>
      </section>
      <section id="pricing" className="vault-section vault-pricing vault-container"><p className="vault-eyebrow">PRICING</p><h2>One payment. Your platform.</h2><p className="vault-section-copy">Lifetime access to your mobile trading world.</p><article className="vault-price-card"><span className="vault-price-badge">APP ACCESS</span><h3>Algo Vault</h3><p className="vault-price">R399.99<span>once-off</span></p><p>Unlock Algo Vault on your phone</p><ul>{["Run your mentor’s Expert Advisor", "Android & iPhone access", "MT4 & MT5 connection", "AI chart scanner", "Robot controls and activity logs"].map(item => <li key={item}><Check />{item}</li>)}</ul><Button asChild size="lg" className="vault-neon"><Link to="/ios">Access AlgoVault <ArrowRight /></Link></Button></article></section>
      <section id="how-it-works" className="vault-section vault-container"><div className="vault-section-heading"><p className="vault-eyebrow">HOW IT WORKS</p><h2>Go live in 3 steps.</h2></div><div className="vault-steps">{[{ title: "Get app access", text: "Enter your email and mentor ID, then contact the admin on WhatsApp if activation is required." }, { title: "Connect your robot", text: "Use your mentor’s licence key to add your Expert Advisor." }, { title: "Make your next move", text: "Connect your MT4 or MT5 account and start your robot when you’re ready." }].map((step, i) => <article key={step.title}><span>0{i + 1}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></section>
      <section id="mentors" className="vault-mentor-band"><div className="vault-container vault-mentor-content"><div><p className="vault-eyebrow">BUILT FOR MENTORS</p><h2>Your expertise.<br />Your own network.</h2><p>Host your EA, manage licences and connect with your clients through the mentor portal.</p><Button asChild className="vault-neon" size="lg"><Link to="/signup">Join as a mentor <ArrowRight /></Link></Button></div><ul>{[{ icon: Cpu, text: "Manage your expert advisor" }, { icon: ShieldCheck, text: "Keep licences under your control" }, { icon: Radio, text: "Connect your client network" }].map(({ icon: Icon, text }) => <li key={text}><Icon /><span>{text}</span><ArrowRight /></li>)}</ul></div></section>
      <section id="download" className="vault-section vault-container vault-download"><p className="vault-eyebrow">YOUR NEXT MOVE</p><h2>Meet the markets.<br />On your terms.</h2><div className="vault-hero-actions justify-center"><Button asChild size="lg" className="vault-neon"><Link to="/ios">Open app · Android & iOS <ArrowRight /></Link></Button><Button variant="outline" size="lg" className="vault-outline" onClick={download} disabled={downloading}><Download />{downloading ? "Preparing download…" : "Download Android"}</Button></div>{notice && <p className="vault-download-notice" role="status">{notice}</p>}<p className="vault-risk">Trading involves risk. Analysis and targets are estimates, not guaranteed returns.</p></section>
    </main>
    <footer className="vault-footer vault-container"><Link to="/" className="vault-brand"><Zap /><span>Algo Vault</span></Link><p>© 2026 Algo Vault</p><Button asChild variant="link"><Link to="/login">Mentor sign in <ArrowRight /></Link></Button></footer>
  </div>;
}
