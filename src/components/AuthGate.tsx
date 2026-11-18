import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePortalSync } from "@/lib/usePortalSync";
import { PortalGate } from "@/components/PortalGate";

export function AuthGate(props: { children: ReactNode; adminOnly?: boolean }) {
  return <PortalGate><AuthGateInner {...props} /></PortalGate>;
}

function AuthGateInner({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();
  usePortalSync();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  if (adminOnly && !profile?.is_admin) {
    return (
      <div className="min-h-screen grid place-items-center text-center px-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Admin only</h1>
          <p className="mt-2 text-sm text-muted-foreground">You don't have access to this page.</p>
          <Link to="/dashboard" className="mt-4 inline-block text-primary">Go to dashboard</Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

