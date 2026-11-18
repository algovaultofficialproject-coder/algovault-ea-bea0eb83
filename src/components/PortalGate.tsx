import type { ReactNode } from "react";

/** Public mentor entry; protected pages still require AuthGate. */
export function PortalGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
