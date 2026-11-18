import { Link, useNavigate } from "@tanstack/react-router";
import {
  LayoutGrid, Key, KeyRound, Bot, LogOut, X, ChevronRight, User, Shield, Radio, MailCheck, Globe, Radar, LineChart,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import botLogo from "@/assets/bot-logo.jpg";

interface Props {
  open: boolean;
  onClose: () => void;
}

const OWNER_EMAIL = "mtwentwabantwana@gmail.com";

export function MentorSidebar({ open, onClose }: Props) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const displayName =
    profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Mentor";
  const isOwner = (profile?.email ?? "").toLowerCase().trim() === OWNER_EMAIL;

  async function logout() {
    await supabase.auth.signOut();
    onClose();
    navigate({ to: "/login" });
  }

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`mentor-menu fixed left-0 top-0 z-50 flex h-full w-[70%] max-w-[18.5rem] flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="mentor-menu-divider flex items-center justify-between px-5 py-5">
          <Link to="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <img src={botLogo} alt="" className="size-8 rounded-lg object-cover" />
            <span className="font-display text-xl font-bold tracking-tight">
              Algo<span className="text-primary">Vault</span> EA
            </span>
          </Link>
          <button onClick={onClose} className="p-2 opacity-90 hover:opacity-100" aria-label="Close menu">
            <X className="size-6" />
          </button>
        </div>

        {/* Profile */}
        <div className="mentor-menu-divider px-4 py-4">
          <Link to="/profile" onClick={onClose} className="mentor-menu-profile flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left">
            <span className="mentor-menu-avatar grid size-10 shrink-0 place-items-center rounded-full">
              <User className="size-4 text-primary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold">{displayName}</span>
              <span className="block truncate text-sm text-primary">
                {profile?.is_admin ? "Admin" : "Mentor"}
                {profile?.mentor_code ? ` · ID ${profile.mentor_code}` : ""}
              </span>
            </span>
            <ChevronRight className="size-5 opacity-80" />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-5 pt-4">
          <div className="space-y-1">
            <SidebarItem to="/dashboard" icon={LayoutGrid} label="Dashboard" onClose={onClose} />
            <SidebarItem to="/generate-key" icon={Key} label="Generate Key" onClose={onClose} />
            <SidebarItem to="/manage-eas" icon={Bot} label="Manage EAs" onClose={onClose} />
          </div>

          <SectionLabel>Management</SectionLabel>
          <div className="space-y-1">
            <SidebarItem to="/key-stats" icon={LineChart} label="Key Stats" onClose={onClose} />
            <SidebarItem to="/signals" icon={Radio} label="Signals" onClose={onClose} />
            {isOwner && (
              <>
                <SidebarItem to="/bridge-keys" icon={KeyRound} label="Bridge API Keys" onClose={onClose} />
                <SidebarItem to="/ndmemail" icon={MailCheck} label="Reactivate Email" onClose={onClose} />
              </>
            )}
            {profile?.is_admin && (
              <>
                <SidebarItem to="/users" icon={Shield} label="Users (Admin)" onClose={onClose} />
                <SidebarItem to="/autotrader" icon={Radar} label="AutoTrader Pro" onClose={onClose} />
              </>
            )}
          </div>

          <SectionLabel>Promotion</SectionLabel>
          <div className="space-y-1">
            <SidebarItem to="/promo-site" icon={Globe} label="Website" onClose={onClose} />
          </div>

          <SectionLabel>My Account</SectionLabel>
          <div className="space-y-1">
            <SidebarItem to="/profile" icon={User} label="Profile" onClose={onClose} />
          </div>
        </nav>

        {/* Logout */}
        <div className="mentor-menu-footer px-3 py-4">
          <button onClick={logout} className="mentor-menu-link flex w-full items-center gap-4 rounded-full px-5 py-3.5 text-[17px]">
            <LogOut className="size-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mentor-menu-label px-5 pb-1.5 pt-6 text-xs font-semibold uppercase tracking-wide">{children}</p>
  );
}

function SidebarItem({
  to,
  icon: Icon,
  label,
  onClose,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClose: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClose}
      className="mentor-menu-link flex items-center gap-4 rounded-full px-5 py-3.5 text-[17px]"
    >
      <Icon className="size-5 shrink-0" />
      <span className="flex-1 font-medium">{label}</span>
      <ChevronRight className="mentor-menu-chevron size-5" />
    </Link>
  );
}
