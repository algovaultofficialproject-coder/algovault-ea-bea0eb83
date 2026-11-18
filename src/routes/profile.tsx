import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Menu, Calendar, User, Phone, Mail, Camera, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MentorSidebar } from "@/components/MentorSidebar";
import { usePortalStore, portalActions } from "@/lib/portal-store";
import { getMyProfile, updateMyProfile } from "@/lib/profile.functions";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile Settings — Algo Vault EA" },
      { property: "og:title", content: "Profile Settings — Algo Vault EA" },
      { property: "og:description", content: "Manage your AlgoVault account details and preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Manage your Algo Vault EA account details and preferences." },
    ],
  }),
  component: () => (<AuthGate><Profile /></AuthGate>),
});

function Profile() {
  const [menuOpen, setMenuOpen] = useState(false);
  const loadProfile = useServerFn(getMyProfile);
  const saveProfile = useServerFn(updateMyProfile);
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const { profileImage } = usePortalStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const initial = (displayName || fullName || email).trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    let alive = true;
    loadProfile()
      .then((p) => {
        if (!alive || !p) return;
        setFullName(p.full_name || "");
        setDisplayName((p.full_name || p.email || "").split(" ")[0].toUpperCase());
        setEmail(p.email || "");
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [loadProfile]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => portalActions.setProfileImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveProfile({ data: { full_name: fullName.trim() || displayName.trim() || "User" } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      setSaved(false);
    }
  };

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button
          onClick={() => setMenuOpen(true)}
          className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <button className="size-11 rounded-xl border border-primary/40 bg-card/60 grid place-items-center text-primary">
          <Calendar className="size-5" />
        </button>
      </header>

      <main className="px-5 pt-4 pb-16 space-y-6 max-w-md mx-auto">
        {/* Hero banner */}
        <section className="rounded-3xl border border-primary/40 bg-gradient-to-br from-primary/40 via-primary/15 to-transparent p-6 text-center shadow-card relative overflow-hidden">
          <h1 className="font-display text-3xl font-bold">Profile Settings</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your account details and preferences
          </p>

          <div className="relative mt-6 mx-auto size-32">
            <div className="size-full rounded-full bg-gradient-primary grid place-items-center overflow-hidden shadow-glow ring-2 ring-primary/40 ring-offset-4 ring-offset-background/40">
              {profileImage ? (
                <img src={profileImage} alt="Profile" className="size-full object-cover" />
              ) : (
                <span className="font-display text-5xl font-bold text-primary-foreground">{initial}</span>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-1 right-1 size-9 rounded-full bg-primary grid place-items-center shadow-glow border-2 border-background"
              aria-label="Change photo"
            >
              <Camera className="size-4 text-primary-foreground" />
            </button>
          </div>

          <p className="mt-4 font-display text-xl font-bold tracking-wider">{displayName || (loading ? "Loading…" : "—")}</p>
          <p className="text-sm text-muted-foreground break-all">{email || (loading ? "…" : "")}</p>
          <p className="mt-3 text-xs text-muted-foreground">JPG, PNG or GIF · Max 2 MB</p>
        </section>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Personal info */}
          <section className="rounded-3xl border border-border bg-gradient-card p-6 shadow-card space-y-5">
            <div className="flex items-center gap-3">
              <p className="text-xs font-bold tracking-[0.25em] uppercase text-primary">
                Personal Information
              </p>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Field icon={User} label="Full Name">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-12 rounded-xl border-border bg-background/40 px-4"
              />
            </Field>

            <Field icon={User} label="Display Name" required>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-12 rounded-xl border-border bg-background/40 px-4"
              />
            </Field>
          </section>

          {/* Contact */}
          <section className="rounded-3xl border border-border bg-gradient-card p-6 shadow-card space-y-5">
            <div className="flex items-center gap-3">
              <p className="text-xs font-bold tracking-[0.25em] uppercase text-primary">
                Contact Details
              </p>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Field icon={Phone} label="Phone Number" required>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                className="h-12 rounded-xl border-border bg-background/40 px-4"
              />
            </Field>

            <Field icon={Mail} label="Email Address">
              <Input
                value={email}
                disabled
                className="h-12 rounded-xl border-border bg-background/40 px-4 opacity-70"
              />
              <p className="mt-2 text-sm text-muted-foreground">Email cannot be changed</p>
            </Field>
          </section>

          {saved && (
            <p className="text-center text-sm font-semibold text-green-400">
              ✓ Changes saved
            </p>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-14 rounded-2xl border-border bg-card/60"
              onClick={() => {
                setPhone("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 h-14 rounded-2xl bg-primary hover:bg-primary/90 font-semibold shadow-glow"
            >
              Save Changes
            </Button>
          </div>
        </form>

        <Footer />
      </main>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  required,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-semibold text-primary/90">
        <Icon className="size-4" />
        {label}
        {required && <span className="text-primary">*</span>}
      </label>
      {children}
    </div>
  );
}

function Footer() {
  return (
    <div className="pt-6 flex flex-col items-center gap-3 text-center">
      <div className="flex items-center gap-2 font-display font-semibold">
        <Zap className="size-4 text-primary" fill="currentColor" />
        Algo <span className="text-primary">Vault</span> EA
      </div>
      <p className="text-sm text-muted-foreground">© 2026 All rights reserved.</p>
    </div>
  );
}
