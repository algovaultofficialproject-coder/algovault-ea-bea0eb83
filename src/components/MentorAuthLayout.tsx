import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck, Zap } from "lucide-react";
import botLogo from "@/assets/bot-logo.jpg";

type Mode = "signin" | "signup";

/** Shared presentation shell for mentor auth pages; each route keeps its own auth logic. */
export function MentorAuthLayout({ title, subtitle, children, footer, mode }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode; mode?: Mode }) {
  return <div className="mentor-auth auth-stage min-h-screen text-foreground flex flex-col">
    <header className="px-5 pt-5 flex items-center justify-between">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="size-4" /> Home</Link>
      <Link to="/ios" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><Zap className="size-4 text-primary" /> Trading app</Link>
    </header>
    <main className="flex-1 grid place-items-center px-4 py-8">
      <section className="auth-card auth-rise w-full max-w-[420px] rounded-[28px] px-6 py-8 sm:px-9 sm:py-10">
        <div className="flex flex-col items-center text-center">
          <img src={botLogo} alt="Algo Vault EA" className="auth-logo size-24 object-cover" />
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">Algo Vault · Mentor portal</p>
          <h1 className="mt-2 font-display text-[28px] leading-tight font-bold">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {mode && <nav aria-label="Account" className="auth-tabs mt-7 grid grid-cols-2 gap-1 rounded-full p-1 text-sm font-semibold">
          <Link to="/login" data-active={mode === "signin"} className="auth-tab rounded-full py-2.5 text-center text-muted-foreground transition-colors">Sign in</Link>
          <Link to="/signup" data-active={mode === "signup"} className="auth-tab rounded-full py-2.5 text-center text-muted-foreground transition-colors">Create account</Link>
        </nav>}
        <div className="mt-7">{children}</div>
        <div className="mt-7 text-center text-sm text-muted-foreground">{footer}</div>
      </section>
      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" /> Secure mentor access · Your keys stay private</p>
    </main>
  </div>;
}

/** Icon-led input with an accessible (visually hidden) label. */
export function AuthField({ id, label, icon, trailing, ...input }: { id: string; label: string; icon: ReactNode; trailing?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <div className="relative">
    <label htmlFor={id} className="sr-only">{label}</label>
    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-[18px]">{icon}</span>
    <input id={id} {...input} className={`auth-input h-14 w-full rounded-2xl border pl-12 ${trailing ? "pr-12" : "pr-4"} text-[15px] text-foreground placeholder:text-muted-foreground outline-none`} />
    {trailing && <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>}
  </div>;
}
